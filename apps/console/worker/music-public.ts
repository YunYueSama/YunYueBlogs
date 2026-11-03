import {validMusicId} from '../src/music-channels';
import {HttpError,json,readJson,readBounded,sha256} from './http';
import {musicService} from './integrations';
import {verifyMusicTicket,issueMusicTicket} from './music-delivery';
import type {ResolvedMusic} from './music-sources';
import {publishedPlayback} from './music-published';
import {musicAddressExpiry} from './music-expiry';
import {playbackContext,resolutionState,claimResolution,storeResolution,failResolution} from './music-resolution-cache';
import {validateResolution} from './music-validation';

export async function publicMusicRoute(request:Request,env:Env,ctx:ExecutionContext,path:string):Promise<Response|undefined>{
  const play=path==='/public/music/play';
  if(!play&&path!=='/public/music/resolve')return;
  const began=performance.now(),deadline=Date.now()+26000;
  if(play?!['GET','HEAD'].includes(request.method):request.method!=='POST')throw new HttpError(405,'请求方式不正确。');
  const input=play?Object.fromEntries(new URL(request.url).searchParams):await readJson(request,12000);
  const data=play&&input.catalog?{action:'play',...await publishedPlayback(env,input as Record<string,string>)}:await verifyMusicTicket(env,String(input.ticket||''),String(input.signature||'')) as {action?:string;track?:{source:string;id:string};preference?:string;exp:number};
  const track=data.track;if(data.action!==(play?'play':'resolve')||!track||!validMusicId(track.source,track.id))throw new HttpError(403,'歌曲请求无效。');
  const catalogMs=performance.now()-began;
  const renewal=play?new URL(request.url).searchParams.get('renewal')||'':'';
  if(renewal&&!/^\d{10,16}$/.test(renewal))throw new HttpError(400,'刷新请求无效。');
  const key=await sha256(JSON.stringify([env.SITE_URL,track,data.preference,renewal]));
  let context=await playbackContext(env,key,track);
  const source=context.source,revision=source?.revision||0,cacheMs=performance.now()-began-catalogMs;
  let resolved=context.cached?.resolved,expiresAt=context.cached?.expiresAt||0,mode=resolved?'shared':'fresh';
  const status=play&&new URL(request.url).searchParams.get('status')==='true';
  // 播放失败后的诊断只查询已有解析结果，不能再触发整套取源和音质回退。
  if(status&&!resolved)return json({error:'音乐音源暂时无法连接，请稍后刷新音源重试。',code:'music_upstream'},503,{'Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin'});
  if(!resolved){
    const custom=source?.value.enabled&&source.value.active;
    if(!custom)throw new HttpError(503,'音乐音源尚未就绪，请稍后重试。');
    const background=(work:Promise<unknown>)=>ctx.waitUntil(work.catch(()=>console.error(JSON.stringify({event:'music_cache_write_failed'}))));
    for(let attempt=0;!resolved&&Date.now()<deadline&&attempt<12;attempt++){
      if(context.failureUntil>Date.now())throw new HttpError(502,'音乐音源暂时无法连接，请稍后重试。','music_upstream');
      const token=context.leaseUntil>Date.now()?undefined:await claimResolution(env,key,revision);
      if(token){
        try{
          const task=musicService<ResolvedMusic>(env,{source:track.source,operation:'resolve',purpose:'published',track,preference:data.preference,script:custom.script});
          ctx.waitUntil(task.then(()=>{},()=>{}));resolved=await task;validateResolution(track,resolved);
          const fallback=data.preference==='lossless'?resolved.mime!=='audio/flac':resolved.quality!=='320 kbps';
          expiresAt=musicAddressExpiry(resolved.url,Date.now(),fallback?60000:900000);
          background(storeResolution(env,key,revision,token,{resolved,expiresAt}));
        }catch(error){background(failResolution(env,key,revision,token));throw error;}
      }else{
        mode='waiting';
        await new Promise(resolve=>setTimeout(resolve,Math.min(2000,250*(attempt+1),Math.max(0,deadline-Date.now()))));
        const next=await resolutionState(env,key,revision,track);context={...context,...next};
        if(next.cached){resolved=next.cached.resolved;expiresAt=next.cached.expiresAt;}
      }
    }
    if(!resolved)throw new HttpError(503,'音乐仍在准备，请稍后重试。','music_preparing');
  }
  const headers={'Access-Control-Allow-Origin':env.SITE_URL,Vary:'Origin','X-Music-Resolution':mode,'Server-Timing':`catalog;dur=${catalogMs.toFixed(1)}, cache;dur=${cacheMs.toFixed(1)}, total;dur=${(performance.now()-began).toFixed(1)}`};
  const response=await playbackResponse(request,env,track,resolved);
  if(!play){for(const [name,value]of Object.entries(headers))response.headers.set(name,value);return response;}
  const result=await response.json<{url:string}>();
  if(new URL(request.url).searchParams.get('prepare')==='true')return json({url:result.url,expiresAt},200,headers);
  if(new URL(request.url).searchParams.get('warm')==='true')return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store',...headers}});
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
  return new Response(null,{status:307,headers:{Location:result.url,'Cache-Control':'private, no-store',...headers,'Referrer-Policy':'no-referrer'}});
}

async function readJsonResponse(response:Response){
  const bytes=await readBounded(response,8000);
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(502,'播放服务暂时无法连接。');}
}

export async function playbackResponse(request:Request,env:Env,track:{source:string;id:string},resolved:ResolvedMusic){
  const upstream=validateResolution(track,resolved);let url=upstream.href;
  if(upstream.protocol!=='https:'){
    const signed=await issueMusicTicket(env,{...track,url:upstream.href,quality:resolved.quality,mime:resolved.mime,size:resolved.size,exp:Math.floor(Date.now()/1000)+600});
    const incoming=new URL(request.url);const base=env.MUSIC_STREAM_ORIGIN||(incoming.hostname==='127.0.0.1'?incoming.origin:'');if(!base)throw new HttpError(503,'独立边缘播放服务尚未配置。');const destination=new URL(base);if(destination.protocol!=='https:'&&destination.hostname!=='127.0.0.1'||destination.pathname!=='/'||destination.username||destination.password||destination.search||destination.hash)throw new HttpError(503,'边缘播放地址配置不正确。');const target=new URL('/public/music/stream',destination);target.searchParams.set('ticket',signed.ticket);target.searchParams.set('signature',signed.signature);url=target.href;
  }
  return json({...resolved,url});
}
