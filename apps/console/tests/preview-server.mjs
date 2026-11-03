import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../../services/password-verifier/api/password.mjs';
import { Readable } from 'node:stream';
import { sourceMetadata } from '../../../services/password-verifier/lib/lx-source.mjs';
import { mediaHost } from '../../../services/password-verifier/lib/music-resolution.mjs';
import { mockMusicOperation } from './mock-integrations.mjs';
import { musicOperation } from '../../../services/password-verifier/api/music.mjs';
import { readPublicContent, importStatements } from '../scripts/import-public.mjs';
import { localPersistence } from '../scripts/local-persistence.mjs';

// 本地验收入口，使用真实 Worker/D1 和 Node 密码计算；不会连接或写入生产资源。
const root=resolve(import.meta.dirname,'..');
const port=Number(process.env.CONSOLE_PREVIEW_PORT||5173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('预览端口无效。');
const bootstrap=JSON.parse(await readFile(process.env.CONSOLE_BOOTSTRAP_FILE,'utf8'));
const localReview=process.env.CONSOLE_LOCAL_REVIEW==='1';
const localActivation=localReview?randomBytes(32).toString('hex'):'';
const localHash=localReview?createHash('sha256').update(localActivation).digest('hex'):'';
const persistence=localPersistence(resolve(root,'.cloudflare/local-review'),localReview);
let settingsKey=randomBytes(32).toString('hex');
if(localReview){const keyFile=resolve(root,'.cloudflare/local-review/settings-key');await mkdir(resolve(root,'.cloudflare/local-review'),{recursive:true});try{settingsKey=await readFile(keyFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(keyFile,settingsKey,{flag:'wx',mode:0o600});}}
const mf=new Miniflare(convertV4MiniflareOptions({...persistence,modules:true,scriptPath:resolve(root,'.cloudflare/output/v0/workers/default/bundle/index.js'),compatibilityDate:'2026-11-02',d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{SETTINGS_ENCRYPTION_KEY:settingsKey,MUSIC_DELIVERY_KEY:settingsKey,MUSIC_DELIVERY_BUDGET_BYTES:'0',PASSWORD_SERVICE_URL:'https://local-password.test/api/password',PASSWORD_SERVICE_KEY:'local-only',SITE_URL:'https://yunyuesama.cn',GITHUB_REPOSITORY:'YunYueSama/YunYueBlog',GITHUB_TOKEN:'',PUBLISH_TOKEN:''},outboundService:async request=>{
  const url=new URL(request.url);
  if(url.hostname==='local-password.test'){
    const body=await request.json();
    if(url.pathname==='/api/music'){try{return WorkerResponse.json(await (localReview?musicOperation(body):mockMusicOperation(body)));}catch{return WorkerResponse.json({error:'music_unavailable'},{status:502});}}
    return WorkerResponse.json(body.operation==='hash'?{hash:await hashPassword(body.password)}:{valid:await verifyPassword(body.password,body.hash)});
  }
  if(!localReview&&url.hostname==='tu.yunyuesama.cn'){return request.method==='POST'?WorkerResponse.json([{src:'/file/acceptance.webp'}]):new WorkerResponse(null,{status:200});}
  // 人工预览仅放行当前公开图床；自动化验收不向外上传或执行第三方写操作。
  if(localReview&&((request.method==='GET'||request.method==='HEAD')&&['netease','kugou','qq','kuwo','migu'].some(source=>mediaHost(url.hostname,source))||url.hostname==='tu.yunyuesama.cn')&&['https:','http:'].includes(url.protocol)&&((url.hostname!=='tu.yunyuesama.cn'&&['GET','HEAD'].includes(request.method))||(request.method==='HEAD'&&url.pathname==='/')||(request.method==='POST'&&url.pathname==='/upload'))){
    try{const response=await fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='POST'?Buffer.from(await request.arrayBuffer()):undefined,redirect:'manual',signal:AbortSignal.timeout(20000)});return new WorkerResponse(response.body,{status:response.status,headers:Object.fromEntries(response.headers)});}catch{}
  }
  return new WorkerResponse(null,{status:503});
}}));
const db=await mf.getD1Database('DB');
for(const migration of (await readdir(resolve(root,'migrations'))).filter(name=>name.endsWith('.sql')).sort())await db.exec((await readFile(resolve(root,'migrations',migration),'utf8')).replace(/\n/g,' '));
// 显式恢复仅写入空的人工预览库；初始化随后使用 INSERT OR IGNORE，不能覆盖恢复的账号或文稿。
if(localReview&&process.env.CONSOLE_LOCAL_RECOVERY_FILE){
  const count=await db.prepare('SELECT COUNT(*) AS n FROM admin_users').first();if(count.n)throw new Error('恢复目标必须为空，已有人工预览数据不会覆盖。');
  const recovery=JSON.parse(await readFile(process.env.CONSOLE_LOCAL_RECOVERY_FILE,'utf8'));
  for(const entry of recovery)await db.prepare(entry.sql).bind(...entry.params).run();
}
// 仅人工本地预览可从显式私有路径初始化已验证音源；不覆盖任何已有设置。
if(localReview&&process.env.CONSOLE_LOCAL_SOURCE_FILE&&!await db.prepare('SELECT name FROM private_settings WHERE name=?').bind('music-source').first()){
  const script=await readFile(process.env.CONSOLE_LOCAL_SOURCE_FILE,'utf8');const stamp=new Date().toISOString();
  const value={enabled:true,fallbackToAccounts:true,active:{script,...sourceMetadata(script),testedAt:stamp,sampleQuality:'320 kbps'}};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(settingsKey,'hex'),iv);cipher.setAAD(Buffer.from('music-source'));
  const encrypted=Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');
  await db.prepare('INSERT OR IGNORE INTO private_settings(name,ciphertext,revision,updated_at) VALUES (?,?,1,?)').bind('music-source',encrypted,stamp).run();
}
for(const entry of [...bootstrap,...importStatements(await readPublicContent())])await db.prepare(localReview?entry.sql.replace('INSERT INTO admin_users','INSERT OR IGNORE INTO admin_users'):entry.sql).bind(...entry.params).run();
const assets=resolve(root,'.cloudflare/output/v0/workers/default/assets');
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/public/music/')){
      const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>5_100_000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      let body=chunks.length?Buffer.concat(chunks):undefined;
      // 仅绑定回环地址的本地验收可自动附带激活票据；仍须校验账号、密码和来源，并强制改密。
      // 生产 Worker 不包含该分支，本地数据也不会上传生产。
      if(localReview&&url.pathname==='/api/auth/login'&&req.method==='POST'&&body&&req.headers.origin===url.origin){
        try {
          const input=JSON.parse(body.toString('utf8'));
          await db.prepare('UPDATE admin_users SET bootstrap_hash=?,bootstrap_expires=? WHERE username=? AND must_change_password=1').bind(localHash,Math.floor(Date.now()/1000)+86400,String(input.username||'')).run();
          body=Buffer.from(JSON.stringify({...input,activationToken:localActivation}));
        } catch { /* 无效输入交给 Worker 的统一校验。 */ }
      }
      const headers=Object.fromEntries(Object.entries(req.headers).filter(([key])=>key!=='content-length').map(([k,v])=>[k,Array.isArray(v)?v.join(','):v||'']));
      const response=await mf.dispatchFetch(url.href,{method:req.method,headers,body});
      res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();return;
    }
    let file=resolve(assets,'.'+decodeURIComponent(url.pathname));
    if(file!==assets&&!file.startsWith(assets+sep)){res.writeHead(403);res.end();return;}
    if(!extname(file)||url.pathname==='/')file=resolve(assets,'index.html');
    if(!(await stat(file)).isFile())throw new Error();
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`LOCAL ACCEPTANCE ONLY: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{server.close();await mf.dispose();process.exit(0);});
