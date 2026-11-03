import {safeLxMetadata,validMusicId,type MusicTrack} from '../src/music-channels';
import {HttpError,readBounded,sha256} from './http';
type Catalog={version:1;revision:string;quality:'lossless'|'320k';tracks:MusicTrack[]};

async function currentCatalog(env:Env){
  const url=new URL('/music-catalog.json',env.SITE_URL);const cache=await caches.open('published-music-v1'),key=new Request(url);
  const cached=await cache.match(key);
  if(cached)return await cached.json<Catalog>();
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(4000)});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();throw new HttpError(503,'公开歌单暂时无法连接，请稍后重试。','catalog_unavailable');}
  const value=JSON.parse(new TextDecoder().decode(await readBounded(response,128000))) as Catalog;
  if(value.version!==1||!['320k','lossless'].includes(value.quality)||!Array.isArray(value.tracks)||value.tracks.length>100||!value.tracks.every(t=>t&&validMusicId(t.source,t.id)&&t.key===`${t.source}:${t.id}`&&typeof t.name==='string'&&t.name.length<=200)||value.revision!==await sha256(JSON.stringify({tracks:value.tracks,quality:value.quality})))throw new HttpError(503,'公开歌单暂时无法读取，请稍后重试。','catalog_unavailable');
  await cache.put(key,Response.json(value,{headers:{'Cache-Control':'public, max-age=60'}}));return value;
}

export async function publishedPlayback(env:Env,input:Record<string,string>){
  if(!/^[a-f0-9]{64}$/.test(input.catalog)||typeof input.track!=='string'||input.track.length>90||input.ticket||input.signature)throw new HttpError(403,'歌曲请求无效。');
  const catalog=await currentCatalog(env);
  if(catalog.revision!==input.catalog)throw new HttpError(409,'公开歌单已更新，请刷新音源后重试。','catalog_changed');
  const track=catalog.tracks.find(t=>t.key===input.track);
  if(!track)throw new HttpError(403,'这首歌尚未发布。');
  // 曲目元数据和音质只取正式站点的公开清单，浏览器不能传入任意取源字段。
  return {track:{...track,lx:safeLxMetadata(track.lx)},preference:catalog.quality==='lossless'&&input.compat!=='mp3'?'lossless':'320k'};
}
