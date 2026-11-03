export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_failed') { super(message); }
}
export const json = (value: unknown, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
export async function readJson(request: Request, limit = 512_000): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, '请使用正确的数据格式。');
  const data = await readBounded(request, limit);
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new HttpError(400, '提交的数据无法识别。'); }
}
export async function readBounded(request: Pick<Request,'headers'|'body'>, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new HttpError(413, '内容超过允许的大小。');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, '内容超过允许的大小。'); }
    chunks.push(next.value);
  }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return all;
}
export function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, '请求来源不正确，请重新打开控制台。', 'invalid_origin');
}
export const text = (v: unknown, max = 200): string => typeof v === 'string' ? v.trim().slice(0, max) : '';
export async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))).map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function secretEqual(a: string, b: string) {
  const [ah, bh] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0; for (let i = 0; i < ah.length; i++) diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
  return diff === 0;
}
