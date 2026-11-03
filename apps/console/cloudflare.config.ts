import { bindings, defineConfig, triggers } from 'cf/config';
import * as entrypoint from './worker/index.ts' with { type: 'cf-worker' };

export default defineConfig(({ mode }) => ({
  worker: {
    name: mode === 'production' ? 'yunyue-console' : 'yunyue-console-staging',
    domains: mode === 'production' ? ['admin.yunyuesama.cn'] : [],
    compatibilityDate: '2026-11-03',
    entrypoint,
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*','/public/music/*'] },
    env: {
      DB: bindings.d1({ name: mode === 'production' ? 'yunyue-console' : 'yunyue-console-staging', ...(process.env.D1_DATABASE_ID ? { id: process.env.D1_DATABASE_ID } : {}) }),
      ...(process.env.ENABLE_PRIVATE_MEDIA === '1' ? { MEDIA: bindings.r2({ name: mode === 'production' ? 'yunyue-private-media' : 'yunyue-private-media-staging' }) } : {}),
      PASSWORD_SERVICE_URL: bindings.text(process.env.PASSWORD_SERVICE_URL || ''),
      PASSWORD_SERVICE_KEY: bindings.secret(),
      SETTINGS_ENCRYPTION_KEY: bindings.secret(),
      MUSIC_STREAM_ORIGIN: bindings.text(process.env.MUSIC_STREAM_ORIGIN||''),
      MUSIC_DELIVERY_KEY: bindings.secret(),
      MUSIC_DELIVERY_BUDGET_BYTES: bindings.text(process.env.MUSIC_DELIVERY_BUDGET_BYTES||'0'),
      PUBLISH_TOKEN: bindings.secret(),
      GITHUB_TOKEN: bindings.secret(),
      GITHUB_REPOSITORY: bindings.text('YunYueSama/YunYueBlog'),
      SITE_URL: bindings.text('https://yunyuesama.cn'),
    },
    triggers: [triggers.scheduled({ schedule: '*/5 * * * *' })],
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true }, traces: { enabled: true, headSamplingRate: 0.01 } },
  },
}));
