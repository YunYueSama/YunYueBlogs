let cachedBase: Promise<string> | undefined;

export function getApiBase() {
  if (!cachedBase) {
    cachedBase = fetch('/backend_config.json', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('无法读取后端端口配置')))
      .then((config: { api_port?: number }) => {
        if (!config.api_port) throw new Error('后端端口配置无效');
        return `http://127.0.0.1:${config.api_port}`;
      });
  }
  return cachedBase;
}

export async function managerApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init?.body && !isFormData ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
  return payload?.data as T;
}
