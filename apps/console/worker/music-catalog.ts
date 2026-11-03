import {musicChannels,validMusicId,safeLxMetadata,type MusicTrack,type ChannelInfo} from '../src/music-channels';
import {HttpError,json,readJson} from './http';
import {readPrivate} from './private-settings';
import {musicService} from './integrations';
import {limit} from './auth';
import type {SourceDefinition,SourceState,ResolvedMusic} from './music-sources';
import {playbackResponse} from './music-public';

export async function sourceChannels(env:Env,source:SourceDefinition):Promise<ChannelInfo[]>{
  if(source.channels?.length)return source.channels;
  const cache=await caches.open('music-capabilities-v1'),key=new Request(`https://music-cache.invalid/capabilities/${source.sha256}`);
  const saved=await cache.match(key);if(saved)return saved.json<ChannelInfo[]>();
  const result=await musicService<{channels:ChannelInfo[]}>(env,{source:'kugou',operation:'source-info',script:source.script});
  const channels=(Array.isArray(result.channels)?result.channels:[]).filter(c=>Object.hasOwn(musicChannels,c.id)).map(c=>({id:c.id,name:musicChannels[c.id].name,qualities:c.qualities.filter(q=>['128k','320k','flac','flac24bit','hires','atmos','master','192k'].includes(q)).slice(0,10)}));
  await cache.put(key,new Response(JSON.stringify(channels),{headers:{'Cache-Control':'public,max-age=3600'}}));return channels;
}
export async function catalogRoute(request:Request,env:Env,path:string):Promise<Response|undefined>{
  if(!['/api/integrations/music/channels','/api/integrations/music/search','/api/integrations/music/preview'].includes(path))return;
  const saved=await readPrivate<SourceState>(env,'music-source'),source=saved?.value.enabled?saved.value.active:undefined;
  if(path.endsWith('/channels')&&request.method==='GET')return json({enabled:!!source,name:source?.name||'',sha256:source?.sha256||'',channels:source?await sourceChannels(env,source):[]});
  if(request.method!=='POST')throw new HttpError(405,'请求方式不正确。');
  if(!source)throw new HttpError(400,'请先导入、测试并启用自定义音源。');
  const input=await readJson(request,16000),channels=await sourceChannels(env,source);
  if(path.endsWith('/search')){
    const channel=String(input.channel||''),query=typeof input.query==='string'?input.query.normalize('NFKC').trim().replace(/\s+/g,' '):'',page=Number(input.page||1);
    if(!channels.some(c=>c.id===channel)||!query||query.length>100||!Number.isInteger(page)||page<1||page>50)throw new HttpError(400,'请选择音源支持的渠道，并输入不超过 100 字的关键词。');
    await limit(env,'music-catalog-search',45,60);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([source.sha256,channel,query.toLocaleLowerCase(),page]))))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const cache=await caches.open('music-catalog-v1'),key=new Request(`https://music-cache.invalid/catalog/${digest}`);const cached=await cache.match(key);if(cached)return json(await cached.json());
    const result=await musicService<{items:unknown[];total:number}>(env,{source:channel,operation:'catalog-search',channel,query,page});
    if(!Array.isArray(result.items)||result.items.length>15||!Number.isFinite(result.total))throw new HttpError(502,'检索结果暂时无法读取，请稍后重试。');
    await cache.put(key,new Response(JSON.stringify(result),{headers:{'Cache-Control':'public,max-age=300'}}));return json(result);
  }
  const raw=input.track as MusicTrack;if(!raw||!validMusicId(raw.source,raw.id)||!channels.some(c=>c.id===raw.source))throw new HttpError(400,'歌曲或渠道不正确。');
  const track={source:raw.source,id:raw.id,name:String(raw.name||'').slice(0,200),artist:String(raw.artist||'').slice(0,200),album:String(raw.album||'').slice(0,200),albumId:String(raw.albumId||'').slice(0,64),albumAudioId:String(raw.albumAudioId||'').slice(0,64),durationMs:Math.max(0,Math.min(3600000,Number(raw.durationMs)||0)),lx:safeLxMetadata(raw.lx)};
  await limit(env,'music-catalog-preview',12,60);
  let result:ResolvedMusic;try{result=await musicService<ResolvedMusic>(env,{source:track.source,operation:'resolve',script:source.script,track,preference:input.preference==='lossless'?'lossless':'320k'});}catch{throw new HttpError(502,'当前音源没有取得这首歌的可播放版本，请换个版本或渠道后试听。');}
  return playbackResponse(request,env,track,result);
}
