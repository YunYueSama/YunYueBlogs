import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {unpackMusicInput} from './lib/music-input.mjs';
import {musicOperation} from './api/music.mjs';

test('压缩脚本恢复为原始输入，旧格式保留兼容，不接受混合或超限输入',()=>{
  const script='/** @name 中文音源 */\nlx.send("inited",{});';
  const input={operation:'source-info',source:'netease',script};
  assert.equal(unpackMusicInput(input),input);
  assert.deepEqual(unpackMusicInput({source:'netease',operation:'source-info',scriptGzip:gzipSync(script).toString('base64')}),input);
  for(const value of [{script,scriptGzip:'AAAA'},{scriptGzip:'not base64!'},{scriptGzip:Buffer.from('plain').toString('base64')},{scriptGzip:gzipSync(Buffer.alloc(256001)).toString('base64')}])assert.throws(()=>unpackMusicInput(value),/invalid_input/);
});
test('分段计时不改变完整音频校验，不在解析结果中暴露内部诊断',async()=>{
  const script=`lx.send('inited',{sources:{wy:{actions:['musicUrl'],qualitys:['320k']}}});lx.on('request',()=> 'https://m7.music.126.net/test.mp3');`;
  const raw=Buffer.alloc(4096);raw.set([255,251,224,0]);
  const timing={};
  const result=await musicOperation({source:'netease',operation:'resolve',script,track:{source:'netease',id:'1'},preference:'320k'},undefined,{timing,request:async()=>({statusCode:206,headers:{'content-range':'bytes 0-4095/4000000'},raw})});
  assert.equal(result.quality,'320 kbps');assert.ok(timing.script>0);assert.ok(timing.media>=0);assert.equal(result.timing,undefined);
});
