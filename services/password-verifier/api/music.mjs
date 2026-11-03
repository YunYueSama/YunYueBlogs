import {sourceMetadata,resolveLx} from '../lib/lx-source.mjs';
import {channels,searchCatalog,validTrackId} from '../lib/music-catalog.mjs';
import {publicRequest} from '../lib/public-request.mjs';
import {resolveCustom,mediaHost} from '../lib/music-resolution.mjs';
import {unpackMusicInput} from '../lib/music-input.mjs';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
const require=createRequire(import.meta.url);

async function provider(source,action,params={},cookie={}) {
  if(source==='netease'){
    const sdk=require('@neteasecloudmusicapienhanced/api');
    return sdk[action]({...params,cookie:Object.entries(cookie).map(([k,v])=>`${k}=${v}`).join('; '),timeout:10000,unblock:false,...(action==='song_url_v1'?{crypto:'eapi'}:{})});
  }
  process.env.platform='lite';
  // 使用字面量入口，让 Serverless 文件追踪同时保留 SDK 的传递依赖。
  require('axios').defaults.timeout=10000;
  const {calculateMid}=require('kugoumusicapi/util/util.js');
  const guid=cookie.KUGOU_API_GUID||createHash('md5').update(randomUUID()).digest('hex');
  const device={...cookie,KUGOU_API_GUID:guid,KUGOU_API_MID:calculateMid(guid),KUGOU_API_DEV:cookie.KUGOU_API_DEV||randomBytes(5).toString('hex').toUpperCase(),KUGOU_API_MAC:cookie.KUGOU_API_MAC||'02:00:00:00:00:00'};
  const {createRequest}=require('kugoumusicapi/util/request.js');
  const methods={search:require('kugoumusicapi/module/search.js'),privilege_lite:require('kugoumusicapi/module/privilege_lite.js')};
  if(!Object.hasOwn(methods,action))throw new Error('invalid_operation');
  const result=await methods[action]({...params,cookie:device},config=>createRequest({...config,cookie:{...device,...config.cookie}}));
  result.cookie=[...(result.cookie||[]),...Object.entries(device).filter(([k])=>k.startsWith('KUGOU_API_')).map(([k,v])=>`${k}=${v}`)];
  return result;
}

// 内部服务只接受具体操作，不开放 SDK 的通用方法、URL、手机号或账号数据查询。
export async function musicOperation(input,call=provider,measurement) {
  const {source,operation}=input;
  const request=measurement?.request||publicRequest;
  if(!Object.hasOwn(channels,source))throw new Error('invalid_source');
  if(operation==='catalog-search')return searchCatalog(input,call);
  if(operation==='source-info'){const manifest=await resolveLx(input.script,null,'320k',request);return {channels:Object.entries(channels).filter(([,value])=>manifest.sources[value.lx]).map(([id,value])=>({id,name:value.name,qualities:manifest.sources[value.lx].qualitys}))};}
  if(operation==='source-import'){
    let script=input.script;
    if(input.url){const url=new URL(input.url);if(url.protocol!=='https:')throw new Error('https_required');const response=await request(url,{maxBytes:256000,timeout:8000});if(response.statusCode!==200)throw new Error('source_download_failed');script=response.raw.toString('utf8');}
    return {script,...sourceMetadata(script),...await musicOperation({source:'kugou',operation:'source-info',script},call,measurement)};
  }
  if(operation==='resolve'){
    const track=input.track;
    if(!track||track.source!==source||!validTrackId(source,track.id))throw new Error('invalid_track');
    if(input.script){const deadline=Date.now()+21000;const catalog=source==='kugou'?(await call(source,'privilege_lite',{hash:track.id})).body?.data?.[0]:null;return resolveCustom({...input,deadline},catalog,request,measurement?.timing);}
    throw new Error('source_required');
  }
  throw new Error('invalid_operation');
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const secret=process.env.PASSWORD_SERVICE_KEY;
  const hash=v=>createHash('sha256').update(v).digest();
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!secret||!timingSafeEqual(hash(req.headers.authorization||''),hash(`Bearer ${secret}`)))return res.status(401).json({error:'unauthorized'});
  const started=performance.now(),timing={};
  const stamp=()=>{res.setHeader('Server-Timing',Object.entries({app:performance.now()-started,...timing}).map(([name,ms])=>`${name};dur=${ms.toFixed(1)}`).join(', '));res.setHeader('X-Music-Region',process.env.VERCEL_REGION||'local');};
  try {
    const raw=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!raw||Buffer.byteLength(JSON.stringify(raw))>600000)return res.status(400).json({error:'invalid_input'});
    const input=unpackMusicInput(raw);
    const request=async(url,...args)=>{
      const began=performance.now(),prefix=mediaHost(new URL(url).hostname,input.source)?'media':'source';
      try{const result=await publicRequest(url,...args);for(const [name,ms] of Object.entries(result.timing||{}))timing[`${prefix}_${name}`]=(timing[`${prefix}_${name}`]||0)+ms;return result;}
      finally{timing[`${prefix}_net`]=(timing[`${prefix}_net`]||0)+performance.now()-began;}
    };
    const result=await musicOperation(input,provider,{request,timing});stamp();return res.status(200).json(result);
  }
  catch(error) {
    stamp();
    if(error?.message==='invalid_input')return res.status(400).json({error:'invalid_input'});
    if(error?.message==='source_cache_miss')return res.status(409).json({error:'source_cache_miss'});
    // 只记录受限分类，不记录脚本、请求正文、上游地址或 SDK 异常详情。
    const category=typeof error?.code==='string'&&/^[A-Z_]{1,40}$/.test(error.code)?error.code:['source_unavailable','source_timeout','source_busy','invalid_source','invalid_track'].includes(error?.message)?error.message:'operation_failed';
    console.warn(JSON.stringify({event:'music_operation_failed',category}));
    return res.status(502).json({error:'music_platform_unavailable'});
  }
}
