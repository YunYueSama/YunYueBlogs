const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/musicCover.ts'), 'utf8');
const context = { exports: {}, URL };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const thumbnail = context.exports.musicCoverThumbnail;

test('平台封面缩小到列表尺寸且保留其他参数', () => {
  assert.equal(thumbnail('http://p1.music.126.net/a.jpg?x=1&param=800y800'), 'https://p1.music.126.net/a.jpg?x=1&param=120y120');
  assert.equal(thumbnail('http://imge.kugou.com/stdmusic/400/a.jpg'), 'https://imge.kugou.com/stdmusic/120/a.jpg');
  assert.equal(thumbnail('https://imge.kugou.com/soft/collection/{size}/a.jpg'), 'https://imge.kugou.com/soft/collection/120/a.jpg');
});
test('保留本地和非平台图片，拒绝非法协议和相似域名匹配', () => {
  assert.equal(thumbnail('/covers/a.jpg'), '/covers/a.jpg');
  assert.equal(thumbnail('https://music.126.net.example.com/a.jpg'), 'https://music.126.net.example.com/a.jpg');
  for (const value of ['', 'javascript:alert(1)', 'data:image/png;base64,abc', '//example.com/a.jpg', 'bad']) assert.equal(thumbnail(value), '');
});
