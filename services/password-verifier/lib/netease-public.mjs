import {createRequire} from 'node:module';
import {inspectMedia} from './music-resolution.mjs';
import {publicRequest} from './public-request.mjs';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),unavailable=new Map();

export function prepareAnonymousState(directory=tmpdir()){
  // 与 SDK 主入口相同的空匿名状态；显式模块入口不会自行创建它。
  try{writeFileSync(join(directory,'anonymous_token'),'',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
}

async function anonymousLookup(id,preference){
  prepareAnonymousState();
  const request=require('@neteasecloudmusicapienhanced/api/util/request.js');
  return request('/api/song/enhance/player/url/v1',{ids:JSON.stringify([Number(id)]),level:preference==='lossless'?'lossless':'exhigh',encodeType:preference==='lossless'?'flac':'mp3'},{crypto:'eapi',cookie:{},timeout:900});
}

// 只接收平台匿名返回的完整文件；试听、较低音质及失败均交回所选音源。
export async function publicNetease(track,preference,{lookup=anonymousLookup,request=publicRequest}={}){
  if(track.source!=='netease'||!(Number(track.durationMs)>=30000))return;
  const key=`${track.id}:${preference}`;if((unavailable.get(key)||0)>Date.now())return;
  try{
    const response=await lookup(track.id,preference),row=response.body?.data?.find(value=>String(value.id)===track.id);
    if(!row?.url||row.freeTrialInfo||Number(row.time)<Number(track.durationMs)*.9||Number(row.br)<320000||preference==='lossless'&&!['lossless','hires','jyeffect','sky','jymaster','vivid'].includes(row.level))throw new Error('not_full_quality');
    const media=await inspectMedia(row.url,'netease',Number(track.durationMs),request);
    if(preference==='lossless'?media.mime!=='audio/flac':media.quality!=='320 kbps')throw new Error('not_full_quality');
    return {...media,adapter:'网易云公开直连'};
  }catch{
    unavailable.set(key,Date.now()+60000);if(unavailable.size>128)unavailable.delete(unavailable.keys().next().value);
  }
}
