import { HttpError, json, readBounded, readJson, text, sha256 } from './http';
import { limit } from './auth';
import { imageType } from './media';
import { readPrivate, writePrivate } from './private-settings';

type Imagebed={name:string;endpoint:string;token:string};
const defaultImagebed={name:'云月图床',endpoint:'https://tu.yunyuesama.cn/upload',token:''};

async function boundedJson(response:Response,max=250000){
  const bytes=await readBounded(response,max);
  try{return JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;}catch{throw new HttpError(502,'服务返回了无法识别的数据，请稍后重试。');}
}
export async function musicService<T>(env:Env,body:object):Promise<T>{
  if(!env.PASSWORD_SERVICE_URL||!env.PASSWORD_SERVICE_KEY)throw new HttpError(503,'音乐解析服务尚未配置。','music_unavailable');
  const url=new URL(env.PASSWORD_SERVICE_URL);url.pathname=url.pathname.replace(/\/password(?:\.mjs)?$/, '/music');
  if(!url.pathname.endsWith('/music'))throw new HttpError(503,'音乐解析服务地址需要使用 /api/password。','music_unavailable');
  try{
    const signal=AbortSignal.timeout(25000);
    const call=(input:object)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.PASSWORD_SERVICE_KEY}`},body:JSON.stringify(input),redirect:'manual',signal});
    const input=body as Record<string,unknown>,script=typeof input.script==='string'?input.script:undefined;
    const metadata={...input};delete metadata.script;
    const scriptSha256=script?await sha256(script):undefined;
    let response=await call(scriptSha256?{...metadata,scriptSha256}:body);
    if(scriptSha256&&response.status===409){
      const error=await boundedJson(response,8000);
      if(error.error!=='source_cache_miss')throw new Error();
      // 温热实例只接收哈希；冷实例补传一次源码，不对取源失败进行重复调用。
      let payload:object={...metadata,script,scriptSha256};
      const scriptBytes=new TextEncoder().encode(script!).length;
      if(scriptBytes>=8192){
        const bytes=new Uint8Array(await new Response(new Blob([script!]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
        let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
        const scriptGzip=btoa(binary);
        if(scriptGzip.length<scriptBytes)payload={...metadata,scriptGzip,scriptSha256};
      }
      response=await call(payload);
    }
    if(!response.ok)throw new Error();
    return await boundedJson(response,600000) as T;
  }catch{throw new HttpError(502,'音乐服务暂时无法连接，请稍后重试。','music_upstream');}
}

function imagebedEndpoint(value:unknown){
  const url=new URL(text(value,2048));
  if(url.protocol!=='https:'||url.hostname!=='tu.yunyuesama.cn'||url.port||url.username||url.password||url.pathname!=='/upload'||url.search||url.hash)throw new HttpError(400,'请使用当前图床的 HTTPS 上传地址：https://tu.yunyuesama.cn/upload。');
  return url.href;
}
export async function integrationRoute(request:Request,env:Env,path:string):Promise<Response|undefined>{
  if(path==='/api/integrations/imagebed'){
    const stored=await readPrivate<Imagebed>(env,'imagebed');const config=stored?.value||defaultImagebed;
    if(request.method==='GET')return json({name:config.name,endpoint:config.endpoint,tokenConfigured:!!config.token,revision:stored?.revision||0});
    if(request.method==='PUT'){
      const input=await readJson(request,10000);const revision=Number(input.revision);
      const next={name:text(input.name,100)||defaultImagebed.name,endpoint:imagebedEndpoint(input.endpoint),token:input.clearToken===true?'':typeof input.token==='string'&&input.token?input.token:config.token};
      if(next.token.length>4096||/[\r\n]/.test(next.token))throw new HttpError(400,'图床 Token 格式不正确。');
      const updated=await writePrivate(env,'imagebed',next,revision);
      return json({name:next.name,endpoint:next.endpoint,tokenConfigured:!!next.token,revision:updated});
    }
  }
  if(path==='/api/integrations/imagebed/check'&&request.method==='POST'){
    const stored=await readPrivate<Imagebed>(env,'imagebed');const url=new URL(stored?.value.endpoint||defaultImagebed.endpoint);url.pathname='/';
    try{const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(8000)});await response.body?.cancel();if(response.status>=500)throw new Error();return json({message:'图床服务可连接。上传权限会在实际上传时核验，本次未上传文件。'});}catch{throw new HttpError(502,'暂时无法连接图床，请核对地址后重试。');}
  }
  if(path==='/api/integrations/imagebed/uploads'&&request.method==='GET')return json({items:(await env.DB.prepare('SELECT id,url,name,mime,size,created_at AS createdAt FROM public_uploads ORDER BY created_at DESC LIMIT 100').all()).results});
  if(path==='/api/integrations/imagebed/upload'&&request.method==='POST'){
    await limit(env,'public-upload',30,3600);
    const config=(await readPrivate<Imagebed>(env,'imagebed'))?.value;
    if(!config?.token)throw new HttpError(503,'请先保存图床 Token，再上传公开图片。','imagebed_unconfigured');
    const data=await readBounded(request,5000000);const mime=imageType(data);
    if(!mime)throw new HttpError(415,'请上传 JPEG、PNG、WebP 或 AVIF 图片。');
    const name=decodeURIComponent(request.headers.get('x-file-name')||'image').replace(/[\r\n/\\]/g,'_').slice(0,160);
    const form=new FormData();form.append('file',new Blob([new Uint8Array(data).buffer],{type:mime}),name);
    const url=new URL(imagebedEndpoint(config.endpoint));url.searchParams.set('uploadNameType','origin');
    let remote:Response;
    try{remote=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:form,redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new HttpError(502,'图床上传结果未确认，请先查看图床管理页，避免重复上传。');}
    if(!remote.ok){await remote.body?.cancel();throw new HttpError(502,[401,403].includes(remote.status)?'图床未接受上传凭据，请更新 Token。':'图床未确认上传，请稍后重试。');}
    const payload=await boundedJson(remote,20000);const item=Array.isArray(payload)?payload[0]:payload;const result=new URL(String(item?.src||item?.url||item?.publicUrl||''),config.endpoint);
    if(result.protocol!=='https:'||result.hostname!=='tu.yunyuesama.cn'||!item?.src&&!item?.url&&!item?.publicUrl)throw new HttpError(502,'图床未返回有效的公开图片地址，请在图床管理页核对。');
    const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO public_uploads(id,url,name,mime,size,created_at) VALUES (?,?,?,?,?,?)').bind(id,result.href,name,mime,data.byteLength,new Date().toISOString()).run();
    return json({id,url:result.href,name,mime,size:data.byteLength},201);
  }
}
