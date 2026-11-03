import { checkOrigin, HttpError, json, readJson, secretEqual, sha256 } from './http';

export type UserRow = { id: string; username: string; password_hash: string; must_change_password: number; password_version: number; bootstrap_hash: string | null; bootstrap_expires: number | null; csrf_token: string; token_hash: string; last_seen: number };
const now = () => Math.floor(Date.now() / 1000);
const cookieName = (request: Request) => new URL(request.url).protocol === 'https:' ? '__Host-yunyue-session' : 'yunyue-session';
const cookie = (request: Request, token: string, maxAge = 43_200) => `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');

export async function limit(env: Pick<Env,'DB'>, key: string, maximum: number, windowSeconds: number) {
  const bucket = `${key}:${Math.floor(now() / windowSeconds)}`;
  const row = await env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(bucket, now() + windowSeconds * 2).first<{ count: number }>();
  if (!row || row.count > maximum) throw new HttpError(429, '操作较频繁，请稍后再试。', 'rate_limited');
}

export async function passwordCall(env: Env, body: object): Promise<{ hash?: string; valid?: boolean }> {
  if (!env.PASSWORD_SERVICE_URL || !env.PASSWORD_SERVICE_KEY) throw new HttpError(503, '登录服务尚未配置，请联系站长。', 'auth_unavailable');
  try {
    const response = await fetch(env.PASSWORD_SERVICE_URL, { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${env.PASSWORD_SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new HttpError(503, '登录服务暂时不可用，请稍后重试。', 'auth_unavailable'); }
}

export async function requireSession(request: Request, env: Env, allowPasswordChange = false): Promise<UserRow> {
  const raw = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName(request)}=`))?.split('=')[1];
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(401, '请先登录。', 'unauthenticated');
  const hash = await sha256(raw);
  const user = await env.DB.prepare('SELECT u.*,s.csrf_token,s.token_hash,s.last_seen FROM sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen>?').bind(hash, now(), now() - 1800).first<UserRow>();
  if (!user) throw new HttpError(401, '登录已过期，请重新登录。', 'unauthenticated');
  if (!['GET', 'HEAD'].includes(request.method)) {
    checkOrigin(request);
    if (!await secretEqual(request.headers.get('x-csrf-token') || '', user.csrf_token)) throw new HttpError(403, '操作凭证已更新，请刷新页面。', 'invalid_csrf');
  }
  if (user.must_change_password && !allowPasswordChange) throw new HttpError(403, '请先修改初始密码。', 'password_change_required');
  if (now() - user.last_seen > 300) await env.DB.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').bind(now(), hash).run();
  return user;
}

export async function authRoute(request: Request, env: Env, path: string): Promise<Response | undefined> {
  if (path === '/api/auth/login' && request.method === 'POST') {
    checkOrigin(request);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    await limit(env, `login-ip:${await sha256(ip)}`, 12, 900);
    await limit(env, 'login-total', 20, 3600);
    const input = await readJson(request, 65_536);
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!username || username.length > 64 || !password) throw new HttpError(400, '请填写账号和密码。');
    const user = await env.DB.prepare('SELECT * FROM admin_users WHERE username=?').bind(username).first<UserRow>();
    if (!user) throw new HttpError(401, '账号或密码不正确。', 'invalid_credentials');
    if (user.must_change_password && (!user.bootstrap_hash || (user.bootstrap_expires || 0) < now() || !await secretEqual(await sha256(typeof input.activationToken === 'string' ? input.activationToken : ''), user.bootstrap_hash))) throw new HttpError(403, '首次登录请使用站长专属的激活链接；链接失效时需重新生成。', 'activation_required');
    if (!(await passwordCall(env, { operation: 'verify', password, hash: user.password_hash })).valid) throw new HttpError(401, '账号或密码不正确。', 'invalid_credentials');
    const raw = token(); const csrfToken = token();
    const rawHash = await sha256(raw);
    const created = await env.DB.batch([
      env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,last_seen,expires_at) SELECT ?,id,?,?,?,? FROM admin_users WHERE id=? AND password_version=? AND (must_change_password=0 OR bootstrap_hash=?)').bind(rawHash, csrfToken, now(), now(), now() + 43_200, user.id, user.password_version, user.bootstrap_hash),
      env.DB.prepare('UPDATE admin_users SET bootstrap_hash=NULL WHERE id=? AND must_change_password=1 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?)').bind(user.id, rawHash),
    ]);
    if (!created[0].meta.changes) throw new HttpError(409, '首次激活已被使用或账号刚被更新，请重新登录。', 'activation_consumed');
    return json({ username: user.username, mustChangePassword: !!user.must_change_password, csrfToken }, 200, { 'Set-Cookie': cookie(request, raw) });
  }
  if (path === '/api/auth/session' && request.method === 'GET') {
    const user = await requireSession(request, env, true);
    return json({ username: user.username, mustChangePassword: !!user.must_change_password, csrfToken: user.csrf_token });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const user = await requireSession(request, env, true);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (path === '/api/auth/password' && request.method === 'POST') {
    const user = await requireSession(request, env, true);
    await limit(env, `password:${user.id}`, 8, 900);
    const input = await readJson(request, 65_536);
    const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    const password = typeof input.newPassword === 'string' ? input.newPassword : '';
    if (!password || password === currentPassword) throw new HttpError(400, '请填写新密码，并使用与当前密码不同的密码。', 'invalid_password');
    if (!(await passwordCall(env, { operation: 'verify', password: currentPassword, hash: user.password_hash })).valid) throw new HttpError(400, '当前密码不正确。', 'invalid_credentials');
    const { hash } = await passwordCall(env, { operation: 'hash', password });
    if (!hash) throw new HttpError(503, '修改未完成，请重试。');
    const raw = token(); const csrfToken = token();
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE admin_users SET password_hash=?,must_change_password=0,password_version=password_version+1,updated_at=? WHERE id=? AND password_version=?').bind(hash, new Date().toISOString(), user.id, user.password_version),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM admin_users WHERE id=? AND password_hash=?)').bind(user.id, user.id, hash),
      env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,last_seen,expires_at) SELECT ?,id,?,?,?,? FROM admin_users WHERE id=? AND password_hash=?').bind(await sha256(raw), csrfToken, now(), now(), now() + 43_200, user.id, hash),
    ]);
    if (!result[0].meta.changes) throw new HttpError(409, '账号已被其他会话更新，请重新登录。', 'conflict');
    return json({ username: user.username, mustChangePassword: false, csrfToken }, 200, { 'Set-Cookie': cookie(request, raw) });
  }
}
