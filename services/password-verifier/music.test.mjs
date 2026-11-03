import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveLx,sourceMetadata} from './lib/lx-source.mjs';
import {publicAddress,publicRequest} from './lib/public-request.mjs';
import {inspectMedia} from './lib/music-resolution.mjs';
import {musicOperation} from './api/music.mjs';

const header=`lx.send('inited',{sources:{kg:{actions:['musicUrl'],qualitys:['320k','flac']}}});`;
const info={source:'kg',hash:'A'.repeat(32)};
test('隔离音源不能访问 Node、环境变量或宿主原型，API 事件可取源',async()=>{
  const script=`${header} lx.on('request',()=>{if(typeof process!=='undefined'||typeof require!=='undefined'||typeof fetch!=='undefined')throw Error();return 'https://fsandroid.tx.kugou.com/test.mp3'});`;
  const result=await resolveLx(script,info);
  assert.equal(result.quality,'320k');
  assert.equal(sourceMetadata('/** @name 测试源 */\n'+script).sha256.length,64);
  await assert.rejects(resolveLx(`${header}lx.on('request',()=>{while(true){}})`,info),/source_/);
  await assert.rejects(resolveLx(`${header}lx.on('request',()=>new Promise(()=>{}))`,info,'320k',undefined,80),/source_timeout/);
});
test('SSRF 拒绝回环、映射 IPv6、内网、云元数据及不允许的协议',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(ip),false);
  assert.equal(publicAddress('1.1.1.1'),true);
  for(const url of ['http://127.0.0.1/','http://169.254.169.254/','file:///etc/passwd','https://example.org:8443/'])await assert.rejects(publicRequest(url));
  const abort=new AbortController();abort.abort();await assert.rejects(publicRequest('https://example.org',{},undefined,abort.signal));
});
test('严格 HTTPS 不可用时仅保留原 HTTP 主机，不猜域名；识别真实 MP3/FLAC',async()=>{
  const calls=[];const raw=Buffer.alloc(4096);raw.set([255,251,224,0]);
  const request=async url=>{calls.push(url);if(url.startsWith('https:'))throw Error('TLS mismatch');return {statusCode:206,headers:{'content-range':'bytes 0-4095/4000000'},raw};};
  const mp3=await inspectMedia('http://fs.youthandroid2.kugou.com/test.mp3','kugou',0,request);
  assert.equal(mp3.quality,'320 kbps');assert.equal(new URL(mp3.url).protocol,'http:');assert.equal(calls.length,2);
  const flac=await inspectMedia('https://fsandroid.tx.kugou.com/test.flac','kugou',0,async()=>({statusCode:206,headers:{'content-range':'bytes 0-4095/19000000'},raw:Buffer.from('fLaCtest')}));
  assert.equal(flac.mime,'audio/flac');
  await assert.rejects(inspectMedia('https://example.org/test.mp3','kugou',0,request));
  await assert.rejects(inspectMedia('http://fs.youthandroid2.kugou.com/test.mp3','kugou',400000,request),/incomplete/);
});
test('音乐服务不再提供扫码、账号及账号取源操作',async()=>{
  for(const operation of ['qr-create','qr-poll','account-status','lookup','playback','arbitrary_sdk_method'])await assert.rejects(musicOperation({source:'netease',operation}),/invalid_operation/);
  await assert.rejects(musicOperation({source:'netease',operation:'resolve',track:{source:'netease',id:'123'}}),/source_required/);
});
