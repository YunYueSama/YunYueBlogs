import { HttpError, json, readBounded, sha256 } from './http';

type MediaRow = { id: string; object_key: string; name: string; mime: string; size: number; sha256: string; created_at: string };
export function imageType(data: Uint8Array): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png';
  if (new TextDecoder().decode(data.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(data.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (new TextDecoder().decode(data.slice(4, 12)) === 'ftypavif') return 'image/avif';
  return null;
}
export async function mediaRoute(request: Request, env: Env & {MEDIA?:R2Bucket}, path: string): Promise<Response | undefined> {
  if (path === '/api/media' && request.method === 'GET') {
    return json({ media: (await env.DB.prepare('SELECT id,name,mime,size,sha256,created_at FROM media ORDER BY created_at DESC LIMIT 100').all()).results });
  }
  if (path === '/api/media' && request.method === 'POST') {
    if (!env.MEDIA) throw new HttpError(503, '私有媒体存储尚未启用，暂时可插入已有公开图片地址。');
    const total = await env.DB.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM media').first<{ bytes: number }>();
    if ((total?.bytes || 0) > 7_000_000_000) throw new HttpError(413, '媒体空间达到保护阈值，请先整理素材。');
    const bytes = await readBounded(request, 5_000_000); const mime = imageType(bytes);
    if (!mime) throw new HttpError(415, '请上传 JPEG、PNG、WebP 或 AVIF 图片，暂不接受 SVG 和其他文件。');
    const id = crypto.randomUUID(); const key = `private/${id}`;
    const hash = await sha256(bytes); const name = decodeURIComponent(request.headers.get('x-file-name') || 'image').replace(/[\r\n]/g, '').slice(0, 160);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    try {
      await env.DB.prepare('INSERT INTO media(id,object_key,name,mime,size,sha256,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, key, name, mime, bytes.byteLength, hash, new Date().toISOString()).run();
    } catch (error) { await env.MEDIA.delete(key); throw error; }
    return json({ id, name, mime, size: bytes.byteLength, url: `/api/media/${id}` }, 201);
  }
  const match = /^\/api\/media\/([a-f0-9-]+)$/.exec(path);
  if (match && request.method === 'GET') {
    if (!env.MEDIA) throw new HttpError(503, '私有媒体存储尚未启用，请使用公开图床。');
    const record = await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(match[1]).first<MediaRow>();
    if (!record) throw new HttpError(404, '素材不存在。');
    const object = await env.MEDIA.get(record.object_key);
    if (!object) throw new HttpError(404, '素材暂时不可用。');
    return new Response(object.body, { headers: { 'Content-Type': record.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
}
