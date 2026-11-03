import type { Session } from './contracts';
export class ApiError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }
let csrf = '';
export const setCsrf = (session: Session | null) => { csrf = session?.csrfToken || ''; };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers: { ...(init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...init.headers } });
  } catch {
    throw new ApiError('网络暂时不可用，请保留当前页面，联网后会继续保存。',0,'network_unavailable');
  }
  const data = await response.json() as { error?: string; code?: string };
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.error || '操作未完成，请重试。', response.status, data.code || 'request_failed');
  }
  return data as T;
}
export function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = href; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
