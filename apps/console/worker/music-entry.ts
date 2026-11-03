import { deliveryRoute, type DeliveryEnv } from './music-delivery';
import { HttpError, json } from './http';

// 独立部署的音频传输入口，不包含管理页面、账号解密密钥或发布权限。
export default {
  async fetch(request: Request, env: DeliveryEnv): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health') return json({ ok: true, service: 'yunyue-music-delivery' });
      return await deliveryRoute(request, env, path) || json({ error: '接口不存在。' }, 404);
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : '播放服务暂时不可用。' }, error instanceof HttpError ? error.status : 503, { 'Access-Control-Allow-Origin': env.SITE_URL, Vary: 'Origin' });
    }
  },
} satisfies ExportedHandler<DeliveryEnv>;
