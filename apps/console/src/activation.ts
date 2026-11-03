const key = 'yunyue-studio-activation';
const tokenPattern = /^[a-f0-9]{64}$/i;

// 激活链接清理后仍可刷新登录页；票据只保留在当前标签页，登录成功即删除。
export function readActivation(): string {
  try {
    const incoming = new URLSearchParams(location.search).get('activate') || '';
    if (tokenPattern.test(incoming)) {
      sessionStorage.setItem(key, JSON.stringify({ token: incoming, expires: Date.now() + 86_400_000 }));
      return incoming;
    }
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved && tokenPattern.test(saved.token) && Number(saved.expires) > Date.now()) return saved.token;
    sessionStorage.removeItem(key);
  } catch { /* 受限浏览器仍可直接打开激活链接登录。 */ }
  return new URLSearchParams(location.search).get('activate') || '';
}

export function clearActivation() {
  try { sessionStorage.removeItem(key); } catch { /* 不影响服务端会话。 */ }
}
