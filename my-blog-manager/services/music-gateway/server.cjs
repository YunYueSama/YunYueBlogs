// 只开放本机控制台所需的正常登录、音源和福利接口，不启动上游通用服务器。
process.env.platform = 'lite';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const netease = require('@neteasecloudmusicapienhanced/api');
const kgRoot = path.dirname(require.resolve('kugoumusicapi/package.json'));
// 上游 SDK 未设置请求期限；为其使用的 Axios 实例补齐超时。
require(require.resolve('axios', { paths: [kgRoot] })).defaults.timeout = 15000;
const { createRequest } = require(path.join(kgRoot, 'util/request'));
const { calculateMid } = require(path.join(kgRoot, 'util/util'));
const token = process.env.MUSIC_GATEWAY_TOKEN;
if (!token) throw new Error('缺少本机服务认证配置');
const routes = {
  netease: new Set(['login_qr_key', 'login_qr_create', 'login_qr_check', 'login_status', 'song_url_v1']),
  kugou: new Set(['login_qr_key', 'login_qr_create', 'login_qr_check', 'user_detail', 'user_vip_detail', 'song_url', 'youth_month_vip_record', 'youth_day_vip']),
};
const server = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  if (request.headers.origin || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(403); response.end('{"error":"forbidden"}'); return;
  }
  if (request.url === '/health') { response.end('{"ok":true}'); return; }
  if (request.method !== 'POST' || request.url !== '/request') { response.writeHead(404); response.end('{}'); return; }
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('body_limit');
    }
    const { source, action, params = {}, cookie = {} } = JSON.parse(raw);
    if (!routes[source]?.has(action)) { response.writeHead(400); response.end('{"error":"invalid_action"}'); return; }
    let result;
    if (source === 'netease') {
      const cookieText = Object.entries(cookie).map(([key, value]) => `${key}=${value}`).join('; ');
      result = await netease[action]({ ...params, cookie: cookieText, unblock: false });
    } else {
      const guid = cookie.KUGOU_API_GUID || crypto.randomUUID();
      const device = { ...cookie, KUGOU_API_GUID: guid, KUGOU_API_MID: calculateMid(guid) };
      const handler = require(path.join(kgRoot, 'module', `${action}.js`));
      result = await handler({ ...params, cookie: device }, (config) => createRequest({ ...config, cookie: { ...device, ...config.cookie } }));
      result.cookie = [...(result.cookie || []), `KUGOU_API_GUID=${guid}`];
    }
    response.end(JSON.stringify({ body: result.body, cookies: result.cookie || [] }));
  } catch {
    // 原始异常可能携带 Cookie、手机号或签名，禁止写入日志和返回前端。
    response.writeHead(502); response.end('{"error":"music_upstream_failed"}');
  }
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log('[音乐服务] 本机网关已就绪'));
