const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../lib/managerApi.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, fetch, Headers, FormData, AbortSignal, DOMException, Error };
  vm.runInNewContext(output, context);
  return context.exports;
}

test('端口配置首次读取失败后可以恢复', async () => {
  let attempts = 0;
  const api = load(async () => {
    if (++attempts === 1) throw new Error('offline');
    return Response.json({ api_port: 8000 });
  });
  await assert.rejects(api.getApiBase(), /offline/);
  assert.equal(await api.getApiBase(), 'http://127.0.0.1:8000');
  assert.equal(attempts, 2);
});

test('拒绝越界端口，避免使用无效的本地服务地址', async () => {
  const api = load(async () => Response.json({ api_port: 70000 }));
  await assert.rejects(api.getApiBase(), /端口配置无效/);
});

test('保留 Headers 对象中的调用方请求头', async () => {
  const api = load(async (url, init) => {
    if (url === '/backend_config.json') return Response.json({ api_port: 8000 });
    assert.equal(init.headers.get('x-check'), 'retained');
    assert.equal(init.headers.get('content-type'), 'application/json');
    return Response.json({ ok: true, data: { saved: true } });
  });
  const result = await api.managerApi('/api/test', { method: 'PUT', headers: new Headers({ 'x-check': 'retained' }), body: '{}' });
  assert.equal(result.saved, true);
});

test('非标准成功响应不能被误认为保存成功', async () => {
  const api = load(async (url) => url === '/backend_config.json'
    ? Response.json({ api_port: 8000 }) : Response.json({ unexpected: true }));
  await assert.rejects(api.managerApi('/api/test'), /数据格式异常/);
});
