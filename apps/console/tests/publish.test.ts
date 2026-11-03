import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let mf: Miniflare;
let db: D1Database;
let marker = { releaseId: 'target-release', snapshotHash: 'target-hash' };
let pageStatus = 200;
let calls: string[] = [];
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: "import {reconcilePublished} from './worker/publish'; export default {async fetch(r,env){await reconcilePublished(env);return new Response('ok')}}", resolveDir: resolve('.') }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-03', d1Databases: ['DB'], bindings: { SITE_URL: 'https://site.example.test' }, outboundService: async request => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    return path === '/release.json' ? WorkerResponse.json(marker) : new WorkerResponse(null, { status: pageStatus });
  } }));
  db = await mf.getD1Database('DB');
  await db.exec((await readFile(resolve('migrations/0001_console.sql'), 'utf8')).replace(/\n/g, ' '));
});
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  marker = { releaseId: 'target-release', snapshotHash: 'target-hash' }; pageStatus = 200; calls = [];
  await db.prepare('DELETE FROM releases').run();
  const stamp = new Date().toISOString();
  await db.prepare("INSERT INTO releases(id,idempotency_key,state,snapshot,snapshot_hash,created_at,updated_at) VALUES ('target-release','unique-key','building',?,'target-hash',?,?)").bind(JSON.stringify([{ kind: 'post', slug: 'public-article' }]), stamp, stamp).run();
});
const reconcile = () => mf.dispatchFetch('https://console.example.test/check');
const row = () => db.prepare('SELECT state,deployment_url,error FROM releases').first<{ state: string; deployment_url: string | null; error: string | null }>();
it('旧站快照或错误哈希不能报告发布成功', async () => {
  marker.snapshotHash = 'old-hash'; await reconcile();
  expect((await row())?.state).toBe('building'); expect(calls).toEqual(['GET /release.json']);
});
it('目标快照、首页和公开文章全部回读通过才标记正式上线', async () => {
  await reconcile();
  expect(await row()).toEqual({ state: 'released', deployment_url: 'https://site.example.test', error: null });
  expect(calls).toEqual(['GET /release.json', 'HEAD /', 'HEAD /posts/public-article']);
});
it('页面失败保留等待状态，短暂故障不误报成功或立即失败', async () => {
  pageStatus = 503; await reconcile();
  expect((await row())?.state).toBe('verifying'); expect((await row())?.deployment_url).toBeNull();
});
it('超过确认期限仍是旧快照时报告失败', async () => {
  marker.releaseId = 'previous-release';
  await db.prepare('UPDATE releases SET created_at=?').bind(new Date(Date.now() - 31 * 60_000).toISOString()).run();
  await reconcile(); expect((await row())?.state).toBe('failed');
});
it('并发核验只能领取一次数据库租约', async () => {
  await Promise.all([reconcile(), reconcile(), reconcile()]);
  expect((await row())?.state).toBe('released'); expect(calls.filter(c => c === 'GET /release.json')).toHaveLength(1);
});
