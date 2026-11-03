import {getQuickJS} from 'quickjs-emscripten';
import {readFile} from 'node:fs/promises';
import {createHash,createCipheriv,publicEncrypt,constants,randomBytes} from 'node:crypto';
import {inflateSync,deflateSync} from 'node:zlib';
import {publicRequest} from './public-request.mjs';

export function sourceMetadata(script){
  if(typeof script!=='string'||Buffer.byteLength(script)>256000||!script.trim()||script.includes('\0'))throw new Error('invalid_script');
  const header=script.slice(0,5000);const field=name=>header.match(new RegExp('\\*?\\s*@'+name+'\\s+([^\\r\\n]+)'))?.[1]?.trim().slice(0,160)||'';
  return {name:field('name')||'自定义音源',version:field('version'),author:field('author'),sha256:createHash('sha256').update(script).digest('hex')};
}

// 每次请求使用独立 WASM 堆；只桥接显式能力，不暴露 Node、数据库、环境变量或音乐账号。
export async function resolveLx(script,musicInfo,quality='320k',request=publicRequest,timeoutMs=21000,cpuBudgetMs=1500){
  sourceMetadata(script);
  const Q=await getQuickJS(),rt=Q.newRuntime();rt.setMemoryLimit(48*1024*1024);rt.setMaxStackSize(512*1024);
  // QQ 渠道的混淆签名计算较重；仅受信任适配层可提高额度，脚本不能修改预算。
  const cpuBudget=Math.min(8000,Math.max(1500,cpuBudgetMs)),turnBudget=Math.min(6000,cpuBudget);
  let cpuDeadline=Date.now()+Math.min(1000,turnBudget),active=true,totalCpuMs=0;rt.setInterruptHandler(()=>Date.now()>cpuDeadline);
  const ctx=rt.newContext(),jobs=new Map(),timers=new Map(),controller=new AbortController(),budget={requests:0,bytes:0};
  const deadline=setTimeout(()=>controller.abort(),Math.min(21000,timeoutMs));
  function execute(code){const start=performance.now();cpuDeadline=Date.now()+Math.min(turnBudget,cpuBudget-totalCpuMs);const r=ctx.evalCode(code);totalCpuMs+=performance.now()-start;if(totalCpuMs>cpuBudget){r.error?.dispose();if(r.value?.alive)r.value.dispose();throw new Error('source_cpu_limit');}if(r.error){r.error.dispose();throw new Error('source_execution_failed');}const value=ctx.dump(r.value);if(r.value.alive)r.value.dispose();return value;}
  function pump(){if(!active)return;cpuDeadline=Date.now()+Math.min(turnBudget,cpuBudget-totalCpuMs);const start=performance.now();const r=rt.executePendingJobs(100);totalCpuMs+=performance.now()-start;if(r.error){r.error.dispose();throw new Error('source_jobs_failed');}if(totalCpuMs>cpuBudget)throw new Error('source_cpu_limit');}
  function expose(name,fn){const h=ctx.newFunction(name,fn);ctx.setProp(ctx.global,name,h);h.dispose();}
  expose('__host_request',(u,o,id)=>{const url=ctx.getString(u),options=JSON.parse(ctx.getString(o)),key=ctx.getNumber(id);
    const pending=request(url,options,budget,controller.signal).then(result=>{if(active)execute(`__deliver(${key},null,${JSON.stringify({statusCode:result.statusCode,headers:result.headers,body:result.body,rawBase64:result.raw.toString('base64')})})`);}).catch(()=>{if(active)try{execute(`__deliver(${key},'网络请求失败',null)`);}catch{}}).finally(()=>{jobs.delete(key);if(active)try{pump();}catch{controller.abort();}});jobs.set(key,pending);return ctx.undefined;
  });
  expose('__host_timer',(id,ms)=>{const key=ctx.getNumber(id);if(timers.size>=100)return ctx.undefined;timers.set(key,setTimeout(()=>{timers.delete(key);if(active)try{execute(`__fire(${key})`);pump();}catch{controller.abort();}},Math.min(21000,Math.max(10,ctx.getNumber(ms)||10))));return ctx.undefined;});
  expose('__host_clear',id=>{const key=ctx.getNumber(id);clearTimeout(timers.get(key));timers.delete(key);return ctx.undefined;});
  expose('__host_crypto',(op,args)=>{const action=ctx.getString(op),a=JSON.parse(ctx.getString(args)),buf=x=>Buffer.from(x);let value;
    if(action==='md5')value=createHash('md5').update(typeof a[0]==='string'?a[0]:buf(a[0])).digest('hex');
    else if(action==='random')value=[...randomBytes(Math.min(4096,Math.max(1,Number(a[0])||1)))];
    else if(action==='aes'){const cipher=createCipheriv(a[1],buf(a[2]),buf(a[3]));value=[...Buffer.concat([cipher.update(buf(a[0])),cipher.final()])];}
    else if(action==='rsa'){const input=buf(a[0]);value=[...publicEncrypt({key:a[1],padding:constants.RSA_NO_PADDING},Buffer.concat([Buffer.alloc(Math.max(0,128-input.length)),input]))];}
    else if(action==='inflate')value=[...inflateSync(buf(a[0]),{maxOutputLength:512000})];
    else if(action==='deflate')value=[...deflateSync(buf(a[0]))];else throw new Error('unsupported_crypto');return ctx.newString(JSON.stringify(value));
  });
  try{
    execute(await readFile(new URL('../generated/lx-buffer.js',import.meta.url),'utf8'));
    execute(`globalThis.window=globalThis;globalThis.self=globalThis;globalThis.console={log(){},warn(){},error(){},debug(){},info(){},clear(){}};globalThis.atob=s=>Buffer.from(s,'base64').toString('binary');globalThis.btoa=s=>Buffer.from(s,'binary').toString('base64');const callbacks=new Map(),timerCallbacks=new Map();let id=0;globalThis.setTimeout=(fn,ms,...args)=>{const key=++id;timerCallbacks.set(key,()=>fn(...args));__host_timer(key,ms);return key};globalThis.clearTimeout=key=>{timerCallbacks.delete(key);__host_clear(key)};globalThis.__fire=key=>{const fn=timerCallbacks.get(key);timerCallbacks.delete(key);fn?.()};globalThis.__deliver=(key,error,response)=>{const cb=callbacks.get(key);callbacks.delete(key);if(response){response.raw=Buffer.from(response.rawBase64,'base64');delete response.rawBase64;}cb?.(error?new Error(error):null,response,response?.body)};const bytes=v=>typeof v==='string'?Array.from(Buffer.from(v)):Array.from(v||[]);const crypt=(op,args)=>JSON.parse(__host_crypto(op,JSON.stringify(args)));globalThis.handlers={};globalThis.initialized=null;globalThis.lx={EVENT_NAMES:{request:'request',inited:'inited',updateAlert:'updateAlert'},version:'2.0.0',env:'desktop',currentScriptInfo:${JSON.stringify(sourceMetadata(script))},on(name,fn){handlers[name]=fn;return Promise.resolve()},send(name,data){if(name==='inited')initialized=data;return Promise.resolve()},request(url,options,cb){const key=++id;callbacks.set(key,cb);__host_request(String(url),JSON.stringify(options||{}),key);return()=>callbacks.delete(key)},utils:{crypto:{md5:v=>crypt('md5',[typeof v==='string'?v:bytes(v)]),randomBytes:n=>Buffer.from(crypt('random',[n])),aesEncrypt:(v,mode,key,iv)=>Buffer.from(crypt('aes',[bytes(v),mode,bytes(key),bytes(iv)])),rsaEncrypt:(v,key)=>Buffer.from(crypt('rsa',[bytes(v),key]))},buffer:{from:(...args)=>Buffer.from(...args),bufToString:(v,fmt)=>Buffer.from(v,'binary').toString(fmt)},zlib:{inflate:v=>Promise.resolve(Buffer.from(crypt('inflate',[bytes(v)]))),deflate:v=>Promise.resolve(Buffer.from(crypt('deflate',[bytes(v)])))}}};`);
    execute(script);pump();
    const wait=async predicate=>{while(!execute(predicate)){if(controller.signal.aborted)throw new Error('source_timeout');await new Promise(r=>setTimeout(r,25));pump();}};
    await wait('Boolean(initialized)');
    const capabilities=execute('initialized');
    if(!musicInfo)return {sources:Object.fromEntries(Object.entries(capabilities.sources||{}).filter(([,value])=>value?.actions?.includes('musicUrl')).map(([key,value])=>[key,{qualitys:Array.isArray(value.qualitys)?value.qualitys.filter(q=>typeof q==='string').slice(0,20):[]}]))};
    const source=musicInfo.source;
    if(!capabilities.sources?.[source]?.actions?.includes('musicUrl')||!capabilities.sources[source].qualitys.includes(quality))throw new Error('unsupported_quality');
    execute(`globalThis.result=null;globalThis.failed=false;Promise.resolve(handlers.request(${JSON.stringify({source,action:'musicUrl',info:{type:quality,musicInfo}})})).then(v=>result=v).catch(()=>failed=true);null;`);pump();await wait('result!==null||failed');
    const value=execute('result');if(typeof value!=='string'||value.length>4096||!/^https?:\/\//.test(value))throw new Error('source_unavailable');
    return {url:value,quality,sourceName:sourceMetadata(script).name};
  }finally{active=false;controller.abort();clearTimeout(deadline);for(const timer of timers.values())clearTimeout(timer);await Promise.allSettled(jobs.values());ctx.dispose();rt.dispose();}
}
