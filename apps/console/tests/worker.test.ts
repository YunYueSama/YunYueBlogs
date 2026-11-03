import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let mf: Miniflare; let db: D1Database;
const base = 'https://studio.example.test';
const initial = 'Bootstrap-only!27'; const changed = '8';
const activationToken='test-only-single-use-activation';
let cookie = ''; let csrf = ''; let oldCookie = ''; let passwordCalls = 0;
async function call(path: string, method = 'GET', body?: object, headers: Record<string,string> = {}) {
  const normalized = new Headers({ ...(cookie?{cookie}:{}), ...(method!=='GET'?{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf}:{}) });
  for (const [key,value] of Object.entries(headers)) normalized.set(key,value);
  return mf.dispatchFetch(base + path, { method, headers: Object.fromEntries(normalized.entries()), body:body?JSON.stringify(body):undefined });
}
beforeAll(async () => {
  const bundle = await build({ entryPoints: [resolve('worker/index.ts')], bundle:true, write:false, format:'esm', platform:'browser', target:'es2022' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules:true, script:bundle.outputFiles[0].text, compatibilityDate:'2026-11-02', d1Databases:['DB'], r2Buckets:['MEDIA'], bindings:{ PASSWORD_SERVICE_URL:'https://password.test/verify',PASSWORD_SERVICE_KEY:'test-internal-key',GITHUB_TOKEN:'',PUBLISH_TOKEN:'',SITE_URL:'https://site.example.test',GITHUB_REPOSITORY:'test/site' }, outboundService: async (request) => {
    passwordCalls++;
    if (new URL(request.url).hostname!=='password.test') return new WorkerResponse(null,{status:503});
    const body=await request.json() as {operation:string;password:string;hash:string};
    return WorkerResponse.json(body.operation==='hash'?{hash:`test:${body.password}`}:{valid:body.hash===`test:${body.password}`});
  }}));
  db = await mf.getD1Database('DB');
  await db.exec((await readFile(resolve('migrations/0001_console.sql'),'utf8')).replace(/\n/g,' '));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(activationToken)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  await db.prepare('INSERT INTO admin_users(id,username,password_hash,bootstrap_hash,bootstrap_expires,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('owner-test','owner',`test:${initial}`,hash,Math.floor(Date.now()/1000)+3600,new Date().toISOString(),new Date().toISOString()).run();
});
afterAll(async()=>{await mf?.dispose();});

describe.sequential('真实 Worker / D1 的管理边界与并发',()=>{
  it('未登录不能读取内容、素材和发布记录',async()=>{
    for(const path of ['/api/documents','/api/media','/api/releases','/api/dashboard']) expect((await call(path)).status).toBe(401);
  });
  it('登录拒绝跨站请求，不在错误中泄露凭据',async()=>{
    const response=await call('/api/auth/login','POST',{username:'owner',password:initial},{Origin:'https://evil.test'});
    expect(response.status).toBe(403);expect(await response.text()).not.toContain(initial);
  });
  it('首次会话只能改密，强制改密由服务端执行',async()=>{
    expect((await call('/api/auth/login','POST',{username:'owner',password:initial})).status).toBe(403);
    const response=await call('/api/auth/login','POST',{username:'owner',password:initial,activationToken});
    expect(response.status,`passwordCalls=${passwordCalls}; ${await response.clone().text()}`).toBe(200); cookie=response.headers.get('set-cookie')!.split(';')[0];oldCookie=cookie;
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(response.headers.get('set-cookie')).toContain('Secure');expect(response.headers.get('set-cookie')).toContain('__Host-');
    const session=await response.json() as {csrfToken:string;mustChangePassword:boolean};csrf=session.csrfToken;expect(session.mustChangePassword).toBe(true);
    for(const path of ['/api/documents','/api/media','/api/releases']){const denied=await call(path);expect(denied.status).toBe(403);expect(await denied.text()).toContain('password_change_required');}
    expect((await call('/api/auth/password','POST',{currentPassword:initial,newPassword:''})).status).toBe(400);
    expect((await call('/api/auth/password','POST',{currentPassword:initial,newPassword:initial})).status).toBe(400);
    expect((await call('/api/auth/password','POST',{currentPassword:initial,newPassword:changed},{'X-CSRF-Token':'forged'})).status).toBe(403);
  });
  it('允许单字符数字密码，改密后撤销旧会话，旧密码失效',async()=>{
    const response=await call('/api/auth/password','POST',{currentPassword:initial,newPassword:changed});expect(response.status).toBe(200);
    cookie=response.headers.get('set-cookie')!.split(';')[0];csrf=(await response.json() as {csrfToken:string}).csrfToken;
    expect((await call('/api/documents')).status).toBe(200);
    expect((await call('/api/auth/session','GET',undefined,{Cookie:oldCookie})).status).toBe(401);
    expect((await call('/api/auth/login','POST',{username:'owner',password:initial})).status).toBe(401);
    expect((await call('/api/auth/login','POST',{username:'owner',password:changed})).status).toBe(200);
  });
  it('两个设备竞争保存时只成功一个，冲突不会插入虚假的修订',async()=>{
    const response=await call('/api/documents','POST',{kind:'post',slug:'concurrent-note',title:'并发文稿',body:'原始正文',metadata:{},publish:false});expect(response.status).toBe(201);
    const doc=await response.json() as {id:string;revision:number};
    const update={kind:'post',slug:'concurrent-note',title:'并发文稿',metadata:{},publish:false,revision:doc.revision};
    const saved=await Promise.all([call(`/api/documents/${doc.id}`,'PUT',{...update,body:'设备 A'}),call(`/api/documents/${doc.id}`,'PUT',{...update,body:'设备 B'})]);
    expect(saved.map(r=>r.status).sort()).toEqual([200,409]);
    const count=await db.prepare('SELECT COUNT(*) AS n FROM document_revisions WHERE document_id=?').bind(doc.id).first<{n:number}>();expect(count?.n).toBe(2);
  });
  it('拒绝路径穿越、非法配置和未配置的公开发布',async()=>{
    expect((await call('/api/documents','POST',{kind:'post',slug:'../private',title:'bad'})).status).toBe(400);
    expect((await call('/api/documents','POST',{kind:'site',slug:'site',title:'bad',body:'[1]'})).status).toBe(400);
    expect((await call('/api/releases','POST',{idempotencyKey:crypto.randomUUID()})).status).toBe(503);
  });
  it('私密文件读请求不会进入共享缓存',async()=>{
    const data=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
    const uploaded=await mf.dispatchFetch(base+'/api/media',{method:'POST',headers:{Cookie:cookie,Origin:base,'X-CSRF-Token':csrf,'Content-Type':'image/png'},body:data});expect(uploaded.status).toBe(201);
    const file=await uploaded.json() as {url:string};
    const readable=await call(file.url);expect(readable.status).toBe(200);expect(readable.headers.get('cache-control')).toBe('private, no-store');
    expect((await call(file.url,'GET',undefined,{Cookie:''})).status).toBe(401);
  });
  it('退出立即撤销会话，服务器重用旧 Cookie 失败',async()=>{
    expect((await call('/api/auth/logout','POST')).status).toBe(200);
    expect((await call('/api/documents')).status).toBe(401);
  });
});
