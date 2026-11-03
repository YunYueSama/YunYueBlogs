import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from '../worker/music-entry.ts' with { type: 'cf-worker' };

export default defineConfig(({ mode }) => ({
  worker: {
    name: mode === 'production' ? 'yunyue-music-delivery' : 'yunyue-music-delivery-staging',
    domains: mode === 'production' ? ['audio.yunyuesama.cn'] : [],
    compatibilityDate: '2026-11-03',
    entrypoint,
    env: {
      DB: bindings.d1({ name: mode === 'production' ? 'yunyue-console' : 'yunyue-console-staging' }),
      MUSIC_DELIVERY_KEY: bindings.secret(),
      MUSIC_DELIVERY_BUDGET_BYTES: bindings.text(process.env.MUSIC_DELIVERY_BUDGET_BYTES || '0'),
      SITE_URL: bindings.text('https://yunyuesama.cn'),
    },
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true }, traces: { enabled: true, headSamplingRate: 0.01 } },
  },
}));
