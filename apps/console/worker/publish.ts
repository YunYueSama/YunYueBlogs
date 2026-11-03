import type { Release, ContentDocument } from '../src/contracts';
import { limit } from './auth';
import { publicFiles, toDocument, type DocumentRow } from './content';
import { HttpError, json, readBounded, readJson, secretEqual, sha256, text } from './http';

type ReleaseRow = { id: string; state: string; snapshot: string; snapshot_hash: string; commit_sha: string | null; deployment_url: string | null; error: string | null; lease_token: string | null; lease_until: number; attempts: number; created_at: string; updated_at: string };
const mapRelease = (r: ReleaseRow): Release => ({ id: r.id, state: r.state, snapshotHash: r.snapshot_hash, commitSha: r.commit_sha || undefined, deploymentUrl: r.deployment_url || undefined, error: r.error || undefined, createdAt: r.created_at, updatedAt: r.updated_at });
const states: Record<string, string[]> = { building: ['verifying', 'failed'], verifying: ['promoting', 'failed'], promoting: ['released', 'failed'] };
const managedPath = (s: string) => /^(posts|chatters|moments|content)\/[^/]+\.md$/.test(s) || /^src\/data\/(site|projects|albums|friends|music)\.json$/.test(s) || s === 'public/release.json';

async function github<T>(env: Env, endpoint: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${endpoint}`, { method, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'YunYue-Cloud-Console', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`github_${response.status}`);
  return response.json<T>();
}

export async function exportRelease(env: Env, id: string) {
  const lease = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
  const claimed = await env.DB.prepare("UPDATE releases SET state='exporting',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND state IN ('queued','exporting') AND lease_until<? AND attempts<3").bind(lease, now + 180, new Date().toISOString(), id, now).run();
  if (!claimed.meta.changes) return;
  const release = (await env.DB.prepare('SELECT * FROM releases WHERE id=?').bind(id).first<ReleaseRow>())!;
  try {
    const files = publicFiles(JSON.parse(release.snapshot) as ContentDocument[], id, release.snapshot_hash);
    const head = await github<{ object: { sha: string } }>(env, 'git/ref/heads/main');
    const commit = await github<{ tree: { sha: string } }>(env, `git/commits/${head.object.sha}`);
    // 初次迁移也要识别现有受管内容，撤下条目不能遗留在构建目录。
    const tree = await github<{ tree: { path: string; type: string }[]; truncated?: boolean }>(env, `git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('tree_too_large');
    const entries: { path: string; mode: string; type: string; content?: string; sha?: null }[] = Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content }));
    for (const entry of tree.tree) if (entry.type === 'blob' && managedPath(entry.path) && !(entry.path in files)) entries.push({ path: entry.path, mode: '100644', type: 'blob', sha: null });
    const nextTree = await github<{ sha: string }>(env, 'git/trees', 'POST', { base_tree: commit.tree.sha, tree: entries });
    const nextCommit = await github<{ sha: string }>(env, 'git/commits', 'POST', { message: `content: publish ${id}`, parents: [head.object.sha], tree: nextTree.sha });
    // 先持久化预期提交，网络超时后可核对远端，不能盲目生成第二份发布。
    await env.DB.prepare('UPDATE releases SET commit_sha=? WHERE id=? AND lease_token=?').bind(nextCommit.sha, id, lease).run();
    const active = await env.DB.prepare("SELECT id FROM releases WHERE id=? AND lease_token=? AND lease_until>? AND state='exporting'").bind(id, lease, Math.floor(Date.now() / 1000)).first();
    if (!active) return;
    await github(env, 'git/refs/heads/main', 'PATCH', { sha: nextCommit.sha, force: false });
    await env.DB.prepare("UPDATE releases SET state='building',lease_until=0,error=NULL,updated_at=? WHERE id=? AND lease_token=?").bind(new Date().toISOString(), id, lease).run();
  } catch {
    await env.DB.prepare("UPDATE releases SET state='failed',error=?,lease_until=0,updated_at=? WHERE id=? AND lease_token=?").bind('公开快照提交未确认。请先核对远端提交与发布工作流，再重试。', new Date().toISOString(), id, lease).run();
  }
}

export async function runPending(env: Env) {
  if (!env.GITHUB_TOKEN) return;
  const rows = await env.DB.prepare("SELECT id FROM releases WHERE state IN ('queued','exporting') AND lease_until<? ORDER BY created_at LIMIT 1").bind(Math.floor(Date.now() / 1000)).all<{ id: string }>();
  for (const row of rows.results) await exportRelease(env, row.id);
  await reconcilePublished(env);
}

// Vercel 的 Git 集成负责构建和原子切换；只有公开快照与页面回读一致才报告上线。
export async function reconcilePublished(env:Env){
  const now=Math.floor(Date.now()/1000);
  const release=await env.DB.prepare("SELECT * FROM releases WHERE state IN ('building','verifying','promoting') AND lease_until<? ORDER BY created_at LIMIT 1").bind(now).first<ReleaseRow>();
  if(!release)return;
  const lease=crypto.randomUUID();
  const claimed=await env.DB.prepare("UPDATE releases SET lease_token=?,lease_until=? WHERE id=? AND lease_until<? AND state IN ('building','verifying','promoting')").bind(lease,now+30,release.id,now).run();
  if(!claimed.meta.changes)return;
  try{
    const site=new URL(env.SITE_URL),url=new URL('/release.json',site);url.searchParams.set('verify',release.id);
    const response=await fetch(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok){await response.body?.cancel();throw new Error('marker_unavailable');}
    const marker=JSON.parse(new TextDecoder().decode(await readBounded(response,4096)));
    if(marker.releaseId!==release.id||marker.snapshotHash!==release.snapshot_hash){if(Date.now()-Date.parse(release.created_at)>30*60*1000)throw new Error('build_not_confirmed');return;}
    await env.DB.prepare("UPDATE releases SET state='verifying',updated_at=? WHERE id=? AND lease_token=?").bind(new Date().toISOString(),release.id,lease).run();
    const docs=JSON.parse(release.snapshot) as ContentDocument[],article=docs.find(d=>['post','chatter'].includes(d.kind));
    const paths=['/',...(article?[`/${article.kind==='post'?'posts':'chatter'}/${encodeURIComponent(article.slug)}`]:[])];
    for(const path of paths){const page=await fetch(new URL(path,site),{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(8000)});if(page.status!==200||new URL(page.url).origin!==site.origin)throw new Error('page_unavailable');}
    await env.DB.prepare("UPDATE releases SET state='released',deployment_url=?,error=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?").bind(site.origin,new Date().toISOString(),release.id,lease).run();
  }catch{
    if(Date.now()-Date.parse(release.created_at)>30*60*1000)await env.DB.prepare("UPDATE releases SET state='failed',error=?,lease_until=0,updated_at=? WHERE id=? AND lease_token=?").bind('公开版本尚未确认，请检查 Vercel 构建记录；上次成功版本仍可能在服务。',new Date().toISOString(),release.id,lease).run();
  }
}

export async function releaseRoute(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response | undefined> {
  if (path.startsWith('/api/internal/')) {
    if (!env.PUBLISH_TOKEN || !await secretEqual(request.headers.get('authorization') || '', `Bearer ${env.PUBLISH_TOKEN}`)) throw new HttpError(401, '未授权。');
    if (path === '/api/internal/release' && request.method === 'POST') {
      const input = await readJson(request, 4096); const id = text(input.id, 80);
      const release = await env.DB.prepare('SELECT * FROM releases WHERE id=?').bind(id).first<ReleaseRow>();
      if (!release || release.commit_sha !== input.commitSha || !states[release.state]?.includes(String(input.state))) throw new HttpError(409, '发布状态或提交版本已改变。');
      let deploymentUrl: string | null = null;
      if (input.deploymentUrl) {
        const url = new URL(String(input.deploymentUrl));
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) throw new HttpError(400, '部署地址不正确。');
        deploymentUrl = url.href;
      }
      if (input.state === 'released') {
        const check = await fetch(`${env.SITE_URL}/release.json?verify=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        const data = await check.json<{ releaseId: string; snapshotHash: string }>();
        if (!check.ok || data.releaseId !== id || data.snapshotHash !== release.snapshot_hash) throw new HttpError(409, '正式站点尚未返回目标版本。');
      }
      await env.DB.prepare('UPDATE releases SET state=?,deployment_url=COALESCE(?,deployment_url),error=?,updated_at=? WHERE id=? AND state=?').bind(String(input.state), deploymentUrl, input.state === 'failed' ? '构建或上线核验失败，正式站点状态请查看运行记录。' : null, new Date().toISOString(), id, release.state).run();
      return json({ ok: true });
    }
    if (path === '/api/internal/claim' && request.method === 'POST') {
      const input = await readJson(request, 1024);
      const release = await env.DB.prepare('SELECT * FROM releases WHERE id=? AND commit_sha=?').bind(text(input.id), text(input.commitSha)).first<ReleaseRow>();
      if (!release || !['building','verifying','promoting'].includes(release.state)) throw new HttpError(409, '此发布已过期或已结束。');
      return json(mapRelease(release));
    }
    return;
  }
  if (path === '/api/releases' && request.method === 'GET') {
    ctx.waitUntil(reconcilePublished(env));
    return json({ releases: (await env.DB.prepare('SELECT * FROM releases ORDER BY created_at DESC LIMIT 30').all<ReleaseRow>()).results.map(mapRelease) });
  }
  if (path === '/api/releases' && request.method === 'POST') {
    if (!env.GITHUB_TOKEN || !env.PUBLISH_TOKEN) throw new HttpError(503, '发布集成尚未配置；草稿已保存在云端。', 'publishing_unavailable');
    const input = await readJson(request, 2048); const key = text(input.idempotencyKey, 80);
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new HttpError(400, '发布操作标识不正确，请重试。');
    const previous = await env.DB.prepare('SELECT * FROM releases WHERE idempotency_key=?').bind(key).first<ReleaseRow>();
    if (previous) return json(mapRelease(previous), 202);
    await limit(env, 'deployments', 20, 86400);
    // 单条查询取得选定公开版本；后续草稿修改不会改变这个不可变快照。
    const docs = (await env.DB.prepare('SELECT * FROM documents WHERE archived=0 AND publish=1 ORDER BY kind,slug').all<DocumentRow>()).results.map(toDocument);
    if (!docs.some(doc => doc.kind === 'site')) throw new HttpError(400, '请先导入站点配置，避免发布不完整快照。');
    const id = crypto.randomUUID(); const snapshot = JSON.stringify(docs); const hash = await sha256(snapshot); const stamp = new Date().toISOString();
    publicFiles(docs, id, hash);
    try { await env.DB.prepare("INSERT INTO releases(id,idempotency_key,state,snapshot,snapshot_hash,created_at,updated_at) VALUES (?,?,'queued',?,?,?,?)").bind(id, key, snapshot, hash, stamp, stamp).run(); }
    catch (error) { if (String(error).includes('UNIQUE')) throw new HttpError(409, '已有发布正在进行，请等待完成。', 'release_in_progress'); throw error; }
    ctx.waitUntil(exportRelease(env, id));
    return json(mapRelease((await env.DB.prepare('SELECT * FROM releases WHERE id=?').bind(id).first<ReleaseRow>())!), 202);
  }
}
