import {publicRequest} from './public-request.mjs';
import {channels} from './music-catalog.mjs';
import {resolveLx,sourceMetadata} from './lx-source.mjs';

export const mediaHost=(host,source)=>source==='netease'?host.endsWith('.music.126.net'):source==='kugou'?['fsandroid.tx.kugou.com','fs.youthandroid.kugou.com','fs.youthandroid2.kugou.com'].includes(host):source==='qq'?(host.endsWith('.stream.qqmusic.qq.com')||host==='wx.music.tc.qq.com'):source==='kuwo'?host.endsWith('.kuwo.cn'):source==='migu'?host.endsWith('.migu.cn'):false;
function encoding(bytes){
  if(bytes.subarray(0,4).toString()==='fLaC')return {mime:'audio/flac',quality:'FLAC 无损'};
  const rates=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
  for(let i=0;i<bytes.length-4;i++)if(bytes[i]===255&&(bytes[i+1]&0xfe)===0xfa){const rate=rates[bytes[i+2]>>4];if([128,320].includes(rate))return {mime:'audio/mpeg',quality:`${rate} kbps`,bitrate:rate*1000};}
  throw new Error('unsupported_media');
}
export async function inspectMedia(raw,source,durationMs=0,request=publicRequest){
  const original=new URL(raw);if(!mediaHost(original.hostname,source)||original.username||original.password||original.port)throw new Error('invalid_media_host');
  const probe=async url=>{
    const budget={requests:0,bytes:0};const response=await request(url.href,{headers:{Range:'bytes=0-4095','Accept-Encoding':'identity'},timeout:2500,maxBytes:8192},budget);
    const match=String(response.headers['content-range']||'').match(/^bytes 0-\d+\/(\d+)$/),size=Number(match?.[1]);
    if(response.statusCode!==206||!Number.isSafeInteger(size)||size<100000||size>128000000)throw new Error('invalid_media_size');
    let bytes=response.raw;let tagBytes=0;
    if(bytes.subarray(0,3).toString()==='ID3'){
      tagBytes=10+((bytes[6]&127)<<21|(bytes[7]&127)<<14|(bytes[8]&127)<<7|bytes[9]&127);if(tagBytes>1000000)throw new Error('invalid_audio_tag');
      if(tagBytes>=bytes.length-4){const next=await request(url.href,{headers:{Range:`bytes=${tagBytes}-${tagBytes+4095}`},timeout:2500,maxBytes:8192},budget);if(next.statusCode!==206)throw new Error('invalid_media_range');bytes=next.raw;}else bytes=bytes.subarray(tagBytes);
    }
    const info=encoding(bytes);
    if(info.bitrate&&durationMs>0&&(size-tagBytes)*8/info.bitrate<durationMs/1000*.75)throw new Error('incomplete_media');
    return {url:url.href,size,...info};
  };
  if(original.protocol==='https:')return probe(original);
  if(original.protocol!=='http:')throw new Error('invalid_media_protocol');
  const secure=new URL(original);secure.protocol='https:';
  try{return await probe(secure);}catch{return probe(original);}
}

let activeResolutions=0;
export async function resolveCustom(input,catalog,request=publicRequest){
  if(activeResolutions>=2)throw new Error('source_busy');
  activeResolutions++;try{return await resolveCustomWork(input,catalog,request);}finally{activeResolutions--;}
}
async function resolveCustomWork(input,catalog,request){
  const meta=sourceMetadata(input.script);const source=channels[input.track.source]?.lx,track=input.track;
  const goods=catalog?.relate_goods||[];const types=goods.flatMap(row=>['128','320','flac'].includes(row.quality)&&row.hash?[{type:row.quality==='flac'?'flac':row.quality+'k',hash:row.hash,size:String(row.info?.filesize||'')}]:[]);
  const info={...(track.lx||{}),name:track.name||catalog?.name||'',singer:track.artist||catalog?.singername||'',source,...(source==='kg'?{hash:track.id}:{}),songmid:source==='wy'?track.id:String(track.lx?.songmid||catalog?.id||track.albumAudioId||track.id),albumAudioId:String(catalog?.album_audio_id||track.albumAudioId||''),albumId:String(catalog?.album_id||track.albumId||track.lx?.albumMid||''),albumName:track.album||catalog?.albumname||'',types:types.length?types:track.lx?.types||[],_types:types.length?Object.fromEntries(types.map(row=>[row.type,row])):track.lx?._types||{},typeUrl:{},img:track.cover||'',interval:`${Math.floor(Number(track.durationMs||0)/60000).toString().padStart(2,'0')}:${Math.floor(Number(track.durationMs||0)/1000%60).toString().padStart(2,'0')}`,_interval:Number(catalog?.info?.duration||track.durationMs||0)/1000};
  if(source==='tx'&&/^\d{1,20}$/.test(String(info.songId)))info.songId=Number(info.songId);
  const deadline=Math.min(Number(input.deadline)||Infinity,Date.now()+21000);
  for(const quality of input.preference==='lossless'?['flac','320k','128k']:['320k','128k']){
    if(Date.now()>deadline-1000)break;
    try{
      const parsed=await resolveLx(input.script,info,quality,request,Math.max(500,deadline-Date.now()-4000),track.source==='qq'?8000:1500);
      const result=await inspectMedia(parsed.url,track.source,Number(catalog?.info?.duration||track.durationMs||0),request);
      if(result.mime==='audio/flac'&&input.preference!=='lossless')continue;
      return {...result,adapter:meta.name};
    }catch{ /* 单个质量或上游失败后，有限回退；不把脚本错误、密钥或 URL 返回给浏览器。 */ }
  }
  throw new Error('source_unavailable');
}
