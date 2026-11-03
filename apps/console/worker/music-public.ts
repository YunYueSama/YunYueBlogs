import {validMusicId} from '../src/music-channels';
import {HttpError,json,readJson,readBounded} from './http';
import {limit} from './auth';
import {readPrivate} from './private-settings';
import {musicService} from './integrations';
import {verifyMusicTicket,issueMusicTicket,allowedMediaHost} from './music-delivery';
import type {ResolvedMusic,SourceState} from './music-sources';
import {publishedPlayback} from './music-published';
import {musicAddressExpiry} from './music-expiry';
const pending=new Map<string,Promise<ResolvedMusic>>();

export async function publicMusicRoute(request:Request,env:Env,ctx:ExecutionContext,path:string):Promise<Response|undefined>{
  const play=path==='/public/music/play';
  if(!play&&path!=='/public/music/resolve')return;
  if(play?!['GET','HEAD'].includes(request.method):request.method!=='POST')throw new HttpError(405,'请求方式不正确。');
  const input=play?Object.fromEntries(new URL(request.url).searchParams):await readJson(request,12000);
  const data=play&&input.catalog?{action:'play',...await publishedPlayback(env,input as Record<string,string>)}:await verifyMusicTicket(env,String(input.ticket||''),String(input.signature||'')) as {action?:string;track?:{source:string;id:string};preference?:string;exp:number};
  const track=data.track;if(data.action!==(play?'play':'resolve')||!track||!validMusicId(track.source,track.id))throw new HttpError(403,'歌曲请求无效。');
  const source=await readPrivate<SourceState>(env,'music-source');
  const renewal=play?new URL(request.url).searchParams.get('renewal')||'':'';
  if(renewal&&!/^\d{10,16}$/.test(renewal))throw new HttpError(400,'刷新请求无效。');
  const version=JSON.stringify([track,data.preference,source?.revision||0,renewal]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const key=new Request(`https://music-cache.invalid/resolved/${hash}`);let resolved:ResolvedMusic|undefined;let expiresAt=0;
  const cache=await caches.open('music-resolution-v2');const cached=await cache.match(key);
  if(cached){const entry=await cached.json<ResolvedMusic&{expiresAt:number}>();if(entry.expiresAt>Date.now()+5000){resolved=entry;expiresAt=entry.expiresAt;}}
  const status=play&&new URL(request.url).searchParams.get('status')==='true';
  // 播放失败后的诊断只查询已有解析结果，不能再触发整套取源和音质回退。
  if(status&&!resolved)return json({error:'音乐音源暂时无法连接，请稍后刷新音源重试。',code:'music_upstream'},503,{'Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin'});
  if(!resolved){
    const custom=source?.value.enabled&&source.value.active;
    if(!custom)throw new HttpError(503,'音乐音源尚未就绪，请稍后重试。');
    let current=pending.get(hash);
    if(!current){
      // 缓存命中不占用远程取源额度，也省去一次 D1 写入往返。
      await limit(env,'public-music-resolution',180,60);
      current=pending.get(hash);
    }
    if(!current){
      if(pending.size>=32)throw new HttpError(503,'播放服务繁忙，请稍后重试。');
      current=musicService<ResolvedMusic>(env,{source:track.source,operation:'resolve',track,preference:data.preference,script:custom.script});
      pending.set(hash,current);
      ctx.waitUntil(current.then(()=>{},()=>{}));
    }
    try{resolved=await current;}finally{if(pending.get(hash)===current)pending.delete(hash);}
    expiresAt=musicAddressExpiry(resolved.url);
    const lifetime=Math.floor((expiresAt-Date.now())/1000);
    if(lifetime>5)ctx.waitUntil(cache.put(key,new Response(JSON.stringify({...resolved,expiresAt}),{headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${lifetime}`}})));
  }
  const response=await playbackResponse(request,env,track,resolved);
  if(!play)return response;
  const result=await response.json<{url:string}>();
  if(new URL(request.url).searchParams.get('prepare')==='true')return json({url:result.url,expiresAt},200,{'Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin'});
  if(new URL(request.url).searchParams.get('warm')==='true')return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store','Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin'}});
  if(status){
    const stream=new URL(result.url);
    if(stream.origin===env.MUSIC_STREAM_ORIGIN&&stream.pathname==='/public/music/stream'){
      stream.searchParams.set('status','true');
      const check=await fetch(stream,{signal:AbortSignal.timeout(2500)});
      const payload=await readJsonResponse(check);
      return json(payload,check.status,{'Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin'});
    }
    return json({available:true},200,{'Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin'});
  }
  return new Response(null,{status:307,headers:{Location:result.url,'Cache-Control':'private, no-store','Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin','Referrer-Policy':'no-referrer'}});
}

async function readJsonResponse(response:Response){
  const bytes=await readBounded(response,8000);
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(502,'播放服务暂时无法连接。');}
}

export async function playbackResponse(request:Request,env:Env,track:{source:string;id:string},resolved:ResolvedMusic){
  if(!resolved||!Number.isSafeInteger(resolved.size)||resolved.size<1||resolved.size>128000000||!['audio/mpeg','audio/flac'].includes(resolved.mime))throw new HttpError(502,'音频格式暂不受支持。');
  const upstream=new URL(resolved.url);if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password||upstream.port||!allowedMediaHost(upstream.hostname,track.source))throw new HttpError(502,'平台音频地址不受支持。');let url=upstream.href;
  if(upstream.protocol!=='https:'){
    const signed=await issueMusicTicket(env,{...track,url:upstream.href,quality:resolved.quality,mime:resolved.mime,size:resolved.size,exp:Math.floor(Date.now()/1000)+600});
    const incoming=new URL(request.url);const base=env.MUSIC_STREAM_ORIGIN||(incoming.hostname==='127.0.0.1'?incoming.origin:'');if(!base)throw new HttpError(503,'独立边缘播放服务尚未配置。');const destination=new URL(base);if(destination.protocol!=='https:'&&destination.hostname!=='127.0.0.1'||destination.pathname!=='/'||destination.username||destination.password||destination.search||destination.hash)throw new HttpError(503,'边缘播放地址配置不正确。');const target=new URL('/public/music/stream',destination);target.searchParams.set('ticket',signed.ticket);target.searchParams.set('signature',signed.signature);url=target.href;
  }
  return json({...resolved,url});
}
