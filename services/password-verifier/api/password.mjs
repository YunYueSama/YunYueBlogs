import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 32, options);
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!match) return false;
  const key = await scrypt(password, match[1], 32, options);
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}

// 密码计算单独放 Node 运行时，避免为了适应免费 Worker 的 CPU 限制而降低哈希强度。
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const secret = process.env.PASSWORD_SERVICE_KEY;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!secret || !equal(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.password !== 'string' || !body.password || Buffer.byteLength(JSON.stringify(body), 'utf8') > 65_536) return res.status(400).json({ error: 'invalid_input' });
    if (body.operation === 'hash') return res.status(200).json({ hash: await hashPassword(body.password) });
    if (body.operation === 'verify' && typeof body.hash === 'string') return res.status(200).json({ valid: await verifyPassword(body.password, body.hash) });
    return res.status(400).json({ error: 'invalid_input' });
  } catch {
    return res.status(503).json({ error: 'password_service_unavailable' });
  }
}
