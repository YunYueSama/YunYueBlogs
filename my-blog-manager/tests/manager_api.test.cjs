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
    if (url === '/api/runtime') return Response.json({ api_port: 8000 });
    assert.equal(init.headers.get('x-check'), 'retained');
    assert.equal(init.headers.get('content-type'), 'application/json');
    return Response.json({ ok: true, data: { saved: true } });
  });
  const result = await api.managerApi('/api/test', { method: 'PUT', headers: new Headers({ 'x-check': 'retained' }), body: '{}' });
  assert.equal(result.saved, true);
});

test('非标准成功响应不能被误认为保存成功', async () => {
  const api = load(async (url) => url === '/api/runtime'
    ? Response.json({ api_port: 8000 }) : Response.json({ unexpected: true }));
  await assert.rejects(api.managerApi('/api/test'), /数据格式异常/);
});

test('账号请求不受内容版本变化影响，其他页面刷新不升级旧表单保存基线', async () => {
  let revision = 'old';
  const writes = [];
  const api = load(async (url, init) => {
    if (url === '/api/runtime') return Response.json({ api_port: 8000 });
    if (init.method === 'POST') {
      writes.push(init.headers.get('X-YunYue-Revision'));
      return Response.json({ ok: false, error: { message: '其他设备更新' } }, { status: 409 });
    }
    return Response.json({ ok: true, data: { revision } }, { headers: { 'X-YunYue-Revision': revision } });
  });
  await api.managerApi('/api/settings/music');
  revision = 'new';
  assert.equal((await api.managerApi('/api/music/accounts')).revision, 'new');
  assert.equal((await api.managerApi('/api/settings/public')).revision, 'new');
  await assert.rejects(api.managerApi('/api/settings/music', { method: 'POST', body: '{}' }), /其他设备/);
  assert.deepEqual(writes, ['old']);
  assert.equal(api.currentCloudRevision(), 'old');
  assert.equal((await api.managerApi('/api/settings/music')).revision, 'new');
});

test('并发读取倒序返回时不能用旧结果覆盖新的编辑基线', async () => {
  let release;
  let count = 0;
  const api = load(async (url) => {
    if (url === '/api/runtime') return Response.json({ api_port: 8000 });
    if (++count === 1) await new Promise(resolve => { release = resolve; });
    return Response.json({ ok: true, data: {} }, { headers: { 'X-YunYue-Revision': count === 1 ? 'old' : 'new' } });
  });
  await api.getApiBase();
  const old = api.managerApi('/api/settings/music');
  await new Promise(resolve => setImmediate(resolve));
  await api.managerApi('/api/settings/music');
  release();
  await assert.rejects(old, /新的请求替代/);
});

test('集成页公开设置保留该页读取版本，其他页面刷新不能放行旧 Bangumi 表单', async () => {
  let revision = 'old';
  const api = load(async (url, init) => {
    if (url === '/api/runtime') return Response.json({ api_port: 8000 });
    if (init.method === 'POST') {
      assert.equal(init.headers.get('X-YunYue-Revision'), 'old');
      return Response.json({ ok: false, error: { message: '公开设置已更新' } }, { status: 409 });
    }
    return Response.json({ ok: true, data: { bangumiUsername: revision } }, { headers: { 'X-YunYue-Revision': revision } });
  });
  await api.managerApi('/api/settings/integrations');
  revision = 'new';
  await api.managerApi('/api/settings/public');
  await assert.rejects(api.managerApi('/api/settings/integrations', {
    method: 'POST', body: JSON.stringify({ bangumiUsername: 'edited-old-form' }),
  }), /公开设置已更新/);
});
