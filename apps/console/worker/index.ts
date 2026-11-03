import {catalogRoute} from './music-catalog';
import {sourceRoute} from './music-sources';
import {publicMusicRoute} from './music-public';
import { authRoute, limit, requireSession } from './auth';
import { contentRoute } from './content';
import { HttpError, json } from './http';
import { releaseRoute, runPending } from './publish';
import { mediaRoute } from './media';
import { integrationRoute } from './integrations';
import { deliveryRoute } from './music-delivery';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      const music=await publicMusicRoute(request,env,ctx,path);if(music)return music;
      const delivery=await deliveryRoute(request,env,path);if(delivery)return delivery;
      if (path === '/api/health') return json({ ok: true, service: 'yunyue-console', version: '3.0.0' });
      const auth = await authRoute(request, env, path); if (auth) return auth;
      if (path.startsWith('/api/internal/')) {
        const result = await releaseRoute(request, env, ctx, path); if (result) return result;
        throw new HttpError(404, '接口不存在。');
      }
      if (path.startsWith('/api/')) {
        const user = await requireSession(request, env);
        if (!['GET', 'HEAD'].includes(request.method)) await limit(env, `write:${user.id}`, 120, 60);
        const result = await contentRoute(request, env, path) || await releaseRoute(request, env, ctx, path) || await mediaRoute(request, env, path) || await integrationRoute(request, env, path) || await sourceRoute(request,env,path) || await catalogRoute(request,env,path);
        if (result) return result;
        if (path === '/api/dashboard' && request.method === 'GET') {
          const [counts, releases] = await env.DB.batch([
            env.DB.prepare('SELECT kind,COUNT(*) AS total,SUM(publish) AS included FROM documents WHERE archived=0 GROUP BY kind'),
            env.DB.prepare('SELECT id,state,created_at,updated_at FROM releases ORDER BY created_at DESC LIMIT 5'),
          ]);
          return json({ counts: counts.results, releases: releases.results, capabilities: { publishing: !!env.GITHUB_TOKEN && !!env.PUBLISH_TOKEN, media: 'MEDIA' in env && !!env.MEDIA }, budgets: { deploymentsPerDay: 20, maxUploadBytes: 5_000_000, vercelOriginTargetBytes: 2_000_000_000, usageAvailable: false } });
        }
      }
      throw new HttpError(404, '接口不存在。');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status,path.startsWith('/public/music/')?{'Access-Control-Allow-Origin':env.SITE_URL,'Vary':'Origin'}:undefined);
      // 日志只记录请求标识，不包含正文、密码、Cookie、签名 URL 或原始数据库异常。
      const requestId = crypto.randomUUID(); console.error(JSON.stringify({ event: 'request_failed', requestId, path }));
      return json({ error: '服务暂时不可用，请稍后重试。', code: 'internal_error', requestId }, 503,path.startsWith('/public/music/')?{'Access-Control-Allow-Origin':env.SITE_URL,'Vary':'Origin'}:undefined);
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runPending(env));
    ctx.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(Math.floor(Date.now() / 1000)).run());
    ctx.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE expires_at<? OR last_seen<?').bind(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) - 1800).run());
    ctx.waitUntil(env.DB.prepare('DELETE FROM music_resolutions WHERE expires_at<=? AND lease_until<=? AND failure_until<=?').bind(Date.now(),Date.now(),Date.now()).run());
  },
} satisfies ExportedHandler<Env>;
