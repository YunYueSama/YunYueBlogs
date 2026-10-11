const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, require: (name) => imports[name], setTimeout, clearTimeout, AbortController, FormData, URL, createImageBitmap() {} };
  vm.runInNewContext(output, context);
  return context.exports;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
test('保存 A 期间输入 B，A 返回后仍保留未保存状态，下一次保存使用已分配 ID', async () => {
  const { DraftSaveCoordinator } = load('lib/draftSave.ts');
  const writes = [], resolvers = [];
  const saver = new DraftSaveCoordinator(null, (payload) => { writes.push(payload); return new Promise((resolve) => resolvers.push(resolve)); });
  let content = 'A'; saver.markChanged();
  const first = saver.save(() => ({ content }));
  content = 'B'; saver.markChanged();
  resolvers.shift()({ id: 'new-draft', lastModified: 1 }); await first;
  assert.equal(saver.dirty, true);
  assert.equal(writes[0].content, 'A');
  const second = saver.save(() => ({ content }));
  assert.equal(writes[1].id, 'new-draft'); assert.equal(writes[1].content, 'B');
  resolvers.shift()({ id: 'new-draft', lastModified: 2 }); await second;
  assert.equal(saver.dirty, false);
});

test('手动保存等待自动保存后补存新版本，不并发创建两个新稿', async () => {
  const { DraftSaveCoordinator } = load('lib/draftSave.ts');
  const writes = [], resolvers = [];
  const saver = new DraftSaveCoordinator(null, (payload) => { writes.push(payload); return new Promise((resolve) => resolvers.push(resolve)); });
  let content = 'A'; saver.markChanged();
  const first = saver.save(() => ({ content }));
  content = 'B'; saver.markChanged();
  const second = saver.save(() => ({ content }));
  assert.equal(writes.length, 1);
  resolvers.shift()({ id: 'one-document', lastModified: 1 }); await tick();
  assert.equal(writes.length, 2); assert.equal(writes[1].id, 'one-document');
  resolvers.shift()({ id: 'one-document', lastModified: 2 }); await Promise.all([first, second]);
  assert.equal(saver.dirty, false);
  await saver.save(() => ({ content })); assert.equal(writes.length, 2);
});

test('保存失败不会清除脏标记，重试继续保存原文档', async () => {
  const { DraftSaveCoordinator } = load('lib/draftSave.ts');
  let failed = true;
  const saver = new DraftSaveCoordinator('existing', async (payload) => {
    assert.equal(payload.id, 'existing');
    if (failed) throw new Error('offline');
    return { id: 'existing', lastModified: 2 };
  });
  saver.markChanged(); await assert.rejects(saver.save(() => ({ content: 'keep me' })), /offline/);
  assert.equal(saver.dirty, true); failed = false;
  await saver.save(() => ({ content: 'keep me' })); assert.equal(saver.dirty, false);
});

test('媒体请求可读取第 120 项之后的分页，保留查询编码和取消信号', async () => {
  let actual;
  const { loadMedia } = load('lib/media.ts', { './managerApi': { managerApi: async (url, init) => { actual = { url, init }; return { items: [], total: 145 }; } } });
  const signal = new AbortController().signal;
  const result = await loadMedia('封面 & 夜', 120, signal);
  assert.equal(actual.url, '/api/picbed/assets?query=%E5%B0%81%E9%9D%A2%20%26%20%E5%A4%9C&offset=120&limit=24');
  assert.equal(actual.init.signal, signal); assert.equal(result.total, 145);
});

test('公开资源预览使用博客域名解析相对路径，保存值保持原样', () => {
  const { publicMediaPreview } = load('lib/media.ts', { './managerApi': {} });
  assert.equal(publicMediaPreview('/images/hero.webp', 'https://blog.example/'), 'https://blog.example/images/hero.webp');
  assert.equal(publicMediaPreview('https://images.example/a.webp', 'https://blog.example'), 'https://images.example/a.webp');
  for (const value of ['/images/hero.webp', 'javascript:alert(1)', '//other.example/a.webp', 'https://user:secret@other.example/a.webp']) assert.equal(publicMediaPreview(value), '');
});

test('发布轮询逐次报告进度，成功只表示 Git 任务成功', async () => {
  const { watchDeployJob } = load('lib/deployJob.ts');
  const statuses = ['queued', 'running', 'succeeded'], observed = [];
  const result = await watchDeployJob('job', async (jobId) => ({ jobId, status: statuses.shift(), message: 'progress' }), (job) => observed.push(job.status), new AbortController().signal, 0);
  assert.deepEqual(observed, ['queued', 'running', 'succeeded']); assert.equal(result.status, 'succeeded');
});

test('轮询预算耗尽保留运行中状态，不伪造任务失败；取消后不再请求', async () => {
  const { watchDeployJob } = load('lib/deployJob.ts');
  let reads = 0;
  const read = async () => { reads++; return { jobId: 'job', status: 'running', message: 'working' }; };
  assert.equal(await watchDeployJob('job', read, () => {}, new AbortController().signal, 0, 2), null);
  assert.equal(reads, 2);
  const controller = new AbortController();
  await assert.rejects(watchDeployJob('job', read, () => controller.abort(), controller.signal, 0));
  assert.equal(reads, 3);
});
