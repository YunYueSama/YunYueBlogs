let cachedBase: Promise<string> | undefined;
let cloudRevision: string | undefined;
export const currentCloudRevision = () => cloudRevision;
const resourceRevisions = new Map<string, string>();
const readOrders = new Map<string, number>();
let requestOrder = 0;

function contentResource(path: string) {
  const clean = path.split('?')[0];
  if (clean === '/api/settings/integrations') return undefined;
  if (clean.startsWith('/api/settings/music')) return '/api/settings/music';
  if (clean.startsWith('/api/settings/')) return clean;
  const group = clean.match(/^\/api\/(gallery|projects|friends|moments|operations|sync)(?:\/|$)/);
  if (group) return `/api/${group[1]}`;
  if (clean === '/api/deploy/push' || clean === '/api/drafts/get' || clean === '/api/drafts/all_tags') return clean;
  return undefined;
}

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
  const resource = contentResource(path);
  const reading = (init?.method || 'GET').toUpperCase() === 'GET' || path.split('?')[0] === '/api/drafts/get';
  const order = ++requestOrder;
  if (resource && reading) readOrders.set(resource, order);
  // 每个编辑页面使用自己读取的版本，其他页面刷新不能替旧表单升级保存凭证。
  const expected = resource ? resourceRevisions.get(resource) || cloudRevision : undefined;
  if (expected && !headers.has('X-YunYue-Revision')) headers.set('X-YunYue-Revision', expected);
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
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
  if (!payload || payload.ok !== true || !('data' in payload)) throw new Error('服务返回的数据格式异常，请重试或重启控制台');
  if (revision && resource) {
    if (reading && readOrders.get(resource) !== order) throw new Error('页面读取已被新的请求替代，请重试');
    resourceRevisions.set(resource, revision);
    // 队列可能来自服务端渲染的旧表单，保留会话基线，不能由无关账号请求更新。
    cloudRevision ??= revision;
  }
  return payload?.data as T;
}
