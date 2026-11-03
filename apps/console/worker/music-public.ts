import {validMusicId} from '../src/music-channels';
import {HttpError,json,readJson} from './http';
import {limit} from './auth';
import {readPrivate} from './private-settings';
import {musicService} from './integrations';
import {verifyMusicTicket,issueMusicTicket,allowedMediaHost} from './music-delivery';
import type {ResolvedMusic,SourceState} from './music-sources';

export async function publicMusicRoute(request:Request,env:Env,ctx:ExecutionContext,path:string):Promise<Response|undefined>{
  if(path!=='/public/music/resolve')return;
  if(request.method!=='POST')throw new HttpError(405,'请求方式不正确。');
  const input=await readJson(request,12000);const data=await verifyMusicTicket(env,String(input.ticket||''),String(input.signature||'')) as {action?:string;track?:{source:string;id:string};preference?:string;exp:number};
  const track=data.track;if(data.action!=='resolve'||!track||!validMusicId(track.source,track.id))throw new HttpError(403,'歌曲请求无效。');
  await limit(env,'public-music-resolution',180,60);
  const source=await readPrivate<SourceState>(env,'music-source');
  const version=JSON.stringify([track,data.preference,source?.revision||0]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const key=new Request(`https://music-cache.invalid/resolved/${hash}`);let resolved:ResolvedMusic|undefined;
  const cache=await caches.open('music-resolution-v1');const cached=await cache.match(key);if(cached)resolved=await cached.json<ResolvedMusic>();
  if(!resolved){
    const custom=source?.value.enabled&&source.value.active;
    if(!custom)throw new HttpError(503,'音乐音源尚未就绪，请稍后重试。');
    resolved=await musicService<ResolvedMusic>(env,{source:track.source,operation:'resolve',track,preference:data.preference,script:custom.script});
    ctx.waitUntil(cache.put(key,new Response(JSON.stringify(resolved),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=60'}})));
  }
  return playbackResponse(request,env,track,resolved);
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
