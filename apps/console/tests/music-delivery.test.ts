import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { mockMusicOperation } from './mock-integrations.mjs';

let mf: Miniflare; let db: D1Database;
let resolutions=0;
const base='https://studio.example.test',secret='c'.repeat(64),csrf='acceptance-csrf',session='a'.repeat(64);
const audio=new Uint8Array(400000).map((_,i)=>i%251);
function sign(data:object){const ticket=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+600,...data})).toString('base64url');return {ticket,signature:createHmac('sha256',Buffer.from(secret,'hex')).update(ticket).digest('base64url')};}
const stream=(data:object)=>'/public/music/stream?'+new URLSearchParams(sign({source:'kugou',id:'A'.repeat(32),url:'http://fs.youthandroid2.kugou.com/test.mp3',quality:'320 kbps',size:audio.length,...data}));
const call=(path:string,method='GET',body?:object,headers:Record<string,string>={})=>mf.dispatchFetch(base+path,{method,headers:{Cookie:`__Host-yunyue-session=${session}`,Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf,...headers},body:body?JSON.stringify(body):undefined});
beforeAll(async()=>{
  const bundle=await build({entryPoints:[resolve('worker/index.ts')],bundle:true,write:false,format:'esm',platform:'browser'});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-03',d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{SETTINGS_ENCRYPTION_KEY:secret,MUSIC_DELIVERY_KEY:secret,MUSIC_DELIVERY_BUDGET_BYTES:'2000000',MUSIC_STREAM_ORIGIN:'https://audio.example.test',PASSWORD_SERVICE_URL:'https://internal.test/api/password',PASSWORD_SERVICE_KEY:'test',SITE_URL:'https://site.example.test'},outboundService:async request=>{
    const url=new URL(request.url);
    if(url.hostname==='internal.test'){const input=await request.json() as {operation:string};if(input.operation==='resolve')resolutions++;return WorkerResponse.json(await mockMusicOperation(input));}
    if(url.hostname==='tu.yunyuesama.cn')return WorkerResponse.json([{src:'/file/test.webp'}]);
    if(url.hostname==='fs.youthandroid2.kugou.com'){
      const range=request.headers.get('range')?.match(/^bytes=(\d+)-(\d+)$/);const start=range?Number(range[1]):0,end=range?Number(range[2]):audio.length-1;
      const bytes=audio.slice(start,end+1);return new WorkerResponse(request.method==='HEAD'?null:bytes,{status:range?206:200,headers:{'Content-Length':String(bytes.length),'Content-Type':'application/octet-stream','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})}});
    }
    return new WorkerResponse(null,{status:503});
  }}));db=await mf.getD1Database('DB');
  for(const name of (await readdir(resolve('migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).replace(/\n/g,' '));
  await db.prepare('INSERT INTO admin_users(id,username,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,0,?,?)').bind('owner','test','unused',new Date().toISOString(),new Date().toISOString()).run();
  const now=Math.floor(Date.now()/1000);await db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').bind(createHash('sha256').update(session).digest('hex'),'owner',csrf,now,now,now+3600).run();
});
afterAll(async()=>mf?.dispose());
describe.sequential('音乐连接、加密设置与边缘传输',()=>{
  it('未登录不可检索，音源未启用时不可检索，旧账号入口已移除',async()=>{
    expect((await call('/api/integrations/music/search','POST',{channel:'qq',query:'半段歌名'},{Cookie:''})).status).toBe(401);
    expect((await call('/api/integrations/music/search','POST',{channel:'qq',query:'半段歌名'})).status).toBe(400);
    expect((await call('/api/integrations/music/accounts')).status).toBe(404);
    expect((await call('/api/integrations/music/qr/create','POST',{})).status).toBe(404);
  });
  it('音源先暂存测试再启用，旧版本不能覆盖且公开摘要不含源码',async()=>{
    const script='/** @name 验收音源 */\nconst PRIVATE_SOURCE_MARKER=1;';
    expect((await call('/api/integrations/music/source/activate','POST',{revision:0})).status).toBe(400);
    const imported=await call('/api/integrations/music/source/import','POST',{revision:0,script});expect(imported.status,await imported.clone().text()).toBe(200);expect(await imported.text()).not.toContain('PRIVATE_SOURCE_MARKER');
    expect((await call('/api/integrations/music/source/activate','POST',{revision:1})).status).toBe(400);
    expect((await call('/api/integrations/music/source/test','POST',{revision:1,track:{source:'kugou',id:'A'.repeat(32)}})).status).toBe(200);
    expect((await call('/api/integrations/music/source/activate','POST',{revision:2})).status).toBe(200);
    expect((await call('/api/integrations/music/source/disable','POST',{revision:1})).status).toBe(409);
    const stored=await db.prepare('SELECT ciphertext FROM private_settings WHERE name=?').bind('music-source').first<{ciphertext:string}>();expect(stored?.ciphertext).not.toContain('PRIVATE_SOURCE_MARKER');
    expect(await (await call('/api/integrations/music/source')).text()).not.toContain('PRIVATE_SOURCE_MARKER');
  });
  it('未签名解析被拒，合法签名只返回 HTTPS 音频地址',async()=>{
    expect((await call('/public/music/resolve','POST',{})).status).toBe(403);
    const response=await call('/public/music/resolve','POST',sign({action:'resolve',track:{source:'kugou',id:'A'.repeat(32)},preference:'320k',exp:Math.floor(Date.now()/1000)+60}));expect(response.status).toBe(200);expect((await response.json() as {url:string}).url).toMatch(/^https:/);
  });
  it('已启用音源可按能力检索五渠道、分页与试听',async()=>{
    const capabilities=await (await call('/api/integrations/music/channels')).json() as {channels:{id:string}[]};expect(capabilities.channels).toHaveLength(5);
    for(const {id:channel} of capabilities.channels){
      const response=await call('/api/integrations/music/search','POST',{channel,query:'半段歌名',page:2});expect(response.status,await response.clone().text()).toBe(200);
      const result=await response.json() as {source:string;items:{source:string;id:string}[];page:number};expect(result.source).toBe(channel);expect(result.page).toBe(2);expect(result.items).toHaveLength(15);
      const preview=await call('/api/integrations/music/preview','POST',{track:result.items[0],preference:'320k'});expect(preview.status,await preview.clone().text()).toBe(200);expect((await preview.json() as {url:string}).url).toMatch(/^https:/);
    }
    expect((await call('/api/integrations/music/search','POST',{channel:'unlisted',query:'a'})).status).toBe(400);
    expect((await call('/api/integrations/music/search','POST',{channel:'qq',query:'a',page:51})).status).toBe(400);
  });
  it('HMAC 篡改、过期、非媒体域名、非法 Range 不会转发',async()=>{
    expect((await call(stream({}).replace(/signature=[^&]+/,'signature=forged'))).status).toBe(403);
    expect((await call(stream({exp:1}))).status).toBe(403);
    expect((await call(stream({url:'http://127.0.0.1/'}))).status).toBe(403);
    expect((await call(stream({}), 'GET',undefined,{Range:'bytes=0-1,4-5'})).status).toBe(416);
  });
  it('首次播放入口验证签名后仅跳转，音频正文不进入管理服务或 Vercel',async()=>{
    const path='/public/music/play?'+new URLSearchParams(sign({action:'play',track:{source:'kugou',id:'A'.repeat(32)},preference:'320k'}));
    const response=await mf.dispatchFetch(base+path,{redirect:'manual'});expect(response.status,await response.clone().text()).toBe(307);expect(response.headers.get('location')).toMatch(/^https:/);expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await call(path.replace(/signature=[^&]+/,'signature=forged'))).status).toBe(403);
    expect((await call('/public/music/play?'+new URLSearchParams(sign({action:'resolve',track:{source:'kugou',id:'A'.repeat(32)},preference:'320k'})))).status).toBe(403);
    expect((await call(path,'POST')).status).toBe(405);
  });
  it('当前歌曲预解析不下载音频，并与同时发生的播放共享取源',async()=>{
    const path='/public/music/play?'+new URLSearchParams(sign({action:'play',track:{source:'kugou',id:'B'.repeat(32)},preference:'320k'}));
    const before=resolutions;
    const [warm,play]=await Promise.all([mf.dispatchFetch(base+path+'&warm=true',{redirect:'manual'}),mf.dispatchFetch(base+path,{redirect:'manual'})]);
    expect(warm.status).toBe(204);expect(await warm.text()).toBe('');expect(play.status).toBe(307);expect(resolutions-before).toBe(1);
  });
  it('失败后的状态查询不再次调用音源，避免一次失败叠加多次慢取源',async()=>{
    const path='/public/music/play?'+new URLSearchParams(sign({action:'play',track:{source:'kugou',id:'C'.repeat(32)},preference:'320k'}))+'&status=true';
    const before=resolutions;const result=await mf.dispatchFetch(base+path);
    expect(result.status).toBe(503);expect(resolutions).toBe(before);
    expect(await result.text()).toContain('稍后刷新音源');
  });
  it('MP3/FLAC 正文及 Range 字节保持一致，HEAD 不计字节预留',async()=>{
    await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'delivery-bytes:%'").run();
    const head=await call(stream({}),'HEAD');expect(head.status,await head.clone().text()).toBe(200);expect(await head.text()).toBe('');
    expect((await db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE 'delivery-bytes:%'").first<{n:number}>())?.n).toBe(0);
    for(const quality of ['320 kbps','FLAC 无损']){
      const response=await call(stream({quality}),'GET',undefined,{Range:'bytes=1024-4095'});expect(response.status).toBe(206);expect(response.headers.get('content-range')).toBe('bytes 1024-4095/400000');expect(response.headers.get('content-type')).toBe(quality==='320 kbps'?'audio/mpeg':'audio/flac');expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio.slice(1024,4096));
    }
  });
  it('预算原子预留并发不能超额；资源变化拒绝播放',async()=>{
    expect((await call(stream({size:audio.length+1}))).status).toBe(502);
    await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'delivery-bytes:%'").run();
    const results=await Promise.all(Array.from({length:6},async()=>{const response=await call(stream({}));return {status:response.status,bytes:new Uint8Array(await response.arrayBuffer())};}));
    expect(results.filter(r=>r.status===200)).toHaveLength(4);expect(results.filter(r=>r.status===429)).toHaveLength(2);
    for(const result of results.filter(r=>r.status===200))expect(result.bytes).toEqual(audio);
    const used=await db.prepare("SELECT SUM(count) AS n FROM rate_limits WHERE key LIKE 'delivery-bytes:%'").first<{n:number}>();expect(used?.n).toBeLessThanOrEqual(2000000);
  });
  it('图床 Token 加密且不回显，上传仅返回公开地址',async()=>{
    const saved=await call('/api/integrations/imagebed','PUT',{revision:0,name:'测试',endpoint:'https://tu.yunyuesama.cn/upload',token:'PRIVATE_TEST_TOKEN'});expect(saved.status).toBe(200);expect(await saved.text()).not.toContain('PRIVATE_TEST_TOKEN');
    const result=await mf.dispatchFetch(base+'/api/integrations/imagebed/upload',{method:'POST',headers:{Cookie:`__Host-yunyue-session=${session}`,Origin:base,'X-CSRF-Token':csrf,'Content-Type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])});expect(result.status,await result.clone().text()).toBe(201);expect((await result.json() as {url:string}).url).toBe('https://tu.yunyuesama.cn/file/test.webp');
  });
  it('有效平台也必须由当前音源声明，换源后旧渠道不可继续检索',async()=>{
    const state=await(await call('/api/integrations/music/source')).json() as {revision:number};const r=state.revision;
    expect((await call('/api/integrations/music/source/import','POST',{revision:r,script:'/** @name 单渠道 */ SINGLE_CHANNEL'})).status).toBe(200);
    expect((await call('/api/integrations/music/source/test','POST',{revision:r+1,track:{source:'netease',id:'123'}})).status).toBe(200);
    expect((await call('/api/integrations/music/source/activate','POST',{revision:r+2})).status).toBe(200);
    expect((await call('/api/integrations/music/search','POST',{channel:'qq',query:'有效但未声明渠道'})).status).toBe(400);
    expect((await call('/api/integrations/music/search','POST',{channel:'netease',query:'有效关键词'})).status).toBe(200);
  });

});
