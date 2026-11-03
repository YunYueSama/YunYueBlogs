import type {ChannelInfo} from '../src/music-channels';
import {sourceChannels} from './music-catalog';
import {HttpError,json,readJson} from './http';
import {readPrivate,writePrivate} from './private-settings';
import {musicService} from './integrations';
import {limit} from './auth';
export type SourceDefinition={script:string;name:string;version:string;author:string;sha256:string;testedAt?:string;sampleQuality?:string;channels?:ChannelInfo[]};
export type SourceState={enabled:boolean;fallbackToAccounts:boolean;active?:SourceDefinition;candidate?:SourceDefinition};
export type ResolvedMusic={url:string;quality:string;mime:string;size:number;adapter:string};
const summary=(value?:SourceDefinition)=>value?{name:value.name,version:value.version,author:value.author,sha256:value.sha256,testedAt:value.testedAt,sampleQuality:value.sampleQuality,channels:value.channels}:null;
export async function sourceRoute(request:Request,env:Env,path:string):Promise<Response|undefined>{
  if(!path.startsWith('/api/integrations/music/source'))return;
  const saved=await readPrivate<SourceState>(env,'music-source');const state=saved?.value||{enabled:false,fallbackToAccounts:false};const revision=saved?.revision||0;
  if(path==='/api/integrations/music/source'&&request.method==='GET'){if(state.active&&!state.active.channels)state.active={...state.active,channels:await sourceChannels(env,state.active)};return json({enabled:state.enabled,fallbackToAccounts:state.fallbackToAccounts,active:summary(state.active),candidate:summary(state.candidate),revision});}
  if(request.method!=='POST')return;
  const action=path.split('/').pop();if(!['import','test','activate','disable'].includes(action||''))return;
  await limit(env,'music-source-actions',15,900);
  const input=await readJson(request,550000);if(input.revision!==revision)throw new HttpError(409,'音源配置已更新，请刷新后继续。','revision_conflict');
  let next=state;let report:Omit<ResolvedMusic,'url'> & {direct:boolean}|undefined;
  if(action==='import'){
    const imported=await musicService<SourceDefinition>(env,{source:'kugou',operation:'source-import',script:input.script,url:input.url});
    if(typeof imported.script!=='string'||new TextEncoder().encode(imported.script).length>256000||!/^[a-f0-9]{64}$/.test(imported.sha256))throw new HttpError(502,'服务未返回有效音源。');
    next={...state,candidate:imported};
  }else if(action==='test'){
    if(!state.candidate)throw new HttpError(400,'请先导入待测试音源。');
    const result=await musicService<ResolvedMusic>(env,{source:(input.track as {source?:string})?.source,operation:'resolve',track:input.track,preference:input.preference==='lossless'?'lossless':'320k',script:state.candidate.script});
    const {url,...details}=result;report={...details,direct:url.startsWith('https:')};
    next={...state,candidate:{...state.candidate,testedAt:new Date().toISOString(),sampleQuality:result.quality}};
  }else if(action==='activate'){
    if(!state.candidate?.testedAt)throw new HttpError(400,'请先测试待启用音源。');
    next={enabled:true,fallbackToAccounts:false,active:state.candidate};
  }else next={...state,enabled:false};
  const updated=await writePrivate(env,'music-source',next,revision);
  return json({enabled:next.enabled,fallbackToAccounts:next.fallbackToAccounts,active:summary(next.active),candidate:summary(next.candidate),revision:updated,report});
}
