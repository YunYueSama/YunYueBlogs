const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/musicCheckQueue.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { mapMusicChecks } = context.exports;

test('检查队列限制在三首并发，结果仍按歌单顺序返回', async () => {
  let active = 0, maximum = 0;
  const result = await mapMusicChecks([1, 2, 3, 4, 5, 6], async value => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 7 - value));
    active--; return value * 2;
  });
  assert.equal(maximum, 3);
  assert.deepEqual(Array.from(result), [2, 4, 6, 8, 10, 12]);
});

test('离开页面取消后不派发下一首检查', async () => {
  const controller = new AbortController();
  const started = [];
  await assert.rejects(mapMusicChecks([1, 2, 3, 4, 5, 6], async value => {
    started.push(value);
    await Promise.resolve();
    controller.abort();
    return value;
  }, 3, controller.signal), { name: 'AbortError' });
  assert.deepEqual(started, [1, 2, 3]);
});
