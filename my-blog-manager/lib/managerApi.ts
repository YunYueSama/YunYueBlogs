let cachedBase: Promise<string> | undefined;
let cloudRevision: string | undefined;
export const currentCloudRevision = () => cloudRevision;

export function getApiBase() {
  if (!cachedBase) {
    cachedBase = fetch('/backend_config.json', { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('无法读取后端端口配置')))
      .then((config: { api_port?: number }) => {
        if (!Number.isInteger(config.api_port) || config.api_port! < 1 || config.api_port! > 65535) throw new Error('后端端口配置无效，请重启控制台');
        return `http://127.0.0.1:${config.api_port}`;
      }).catch((error) => {
        // 失败不永久缓存，恢复服务后允许再次读取配置。
        cachedBase = undefined;
        throw error;
      });
  }
  return cachedBase;
}

export async function managerApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers = new Headers(init?.headers);
  if (cloudRevision) headers.set('X-YunYue-Revision', cloudRevision);
  if (init?.body && !isFormData && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('服务响应超时，请稍后重试；提交操作前请先确认当前状态');
    throw new Error('无法连接本地服务，请检查控制台是否正常运行');
  }
  const payload = await response.json().catch(() => null);
  const revision = response.headers.get('X-YunYue-Revision');
  if (revision && cloudRevision && revision !== cloudRevision && path !== '/api/cloud/connect') {
    throw new Error('服务器内容已更新，请刷新页面后再继续；尚未提交的输入请先保留。');
  }
  if (revision) cloudRevision = revision;
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
  if (!payload || payload.ok !== true || !('data' in payload)) throw new Error('服务返回的数据格式异常，请重试或重启控制台');
  return payload?.data as T;
}
