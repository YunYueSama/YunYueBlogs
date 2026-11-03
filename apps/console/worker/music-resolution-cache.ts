import {decodePrivate} from './private-settings';
import type {ResolvedMusic,SourceState} from './music-sources';
import {validateResolution} from './music-validation';
import {HttpError} from './http';

type CacheRow={result_json:string|null;expires_at:number;lease_token:string;lease_until:number;failure_until:number};
type ContextRow=CacheRow&{ciphertext:string;revision:number};
export type CachedResolution={resolved:ResolvedMusic;expiresAt:number};
export type ResolutionState={cached?:CachedResolution;leaseUntil:number;failureUntil:number};

async function state(env:Env,key:string,revision:number,row:CacheRow|null,track:{source:string}):Promise<ResolutionState>{
  let cached:CachedResolution|undefined;
  if(row?.result_json&&row.expires_at>Date.now()+5000){
    try{const value=JSON.parse(row.result_json) as ResolvedMusic;validateResolution(track,value);cached={resolved:value,expiresAt:row.expires_at};}
    catch{
      await env.DB.prepare('UPDATE music_resolutions SET result_json=NULL,expires_at=0 WHERE cache_key=? AND source_revision=? AND result_json=?').bind(key,revision,row.result_json).run();
    }
  }
  return {cached,leaseUntil:Number(row?.lease_until)||0,failureUntil:Number(row?.failure_until)||0};
}

export async function playbackContext(env:Env,key:string,track:{source:string}){
  // 同一次 D1 往返读取音源修订和地址，禁用或换源后不会命中旧修订。
  const row=await env.DB.prepare("SELECT s.ciphertext,s.revision,c.result_json,c.expires_at,c.lease_token,c.lease_until,c.failure_until FROM private_settings s LEFT JOIN music_resolutions c ON c.cache_key=? AND c.source_revision=s.revision WHERE s.name='music-source'").bind(key).first<ContextRow>();
  const source=await decodePrivate<SourceState>(env,'music-source',row);
  return {source,...await state(env,key,source?.revision||0,row,track)};
}

export async function resolutionState(env:Env,key:string,revision:number,track:{source:string}){
  const row=await env.DB.prepare('SELECT result_json,expires_at,lease_token,lease_until,failure_until FROM music_resolutions WHERE cache_key=? AND source_revision=?').bind(key,revision).first<CacheRow>();
  return state(env,key,revision,row,track);
}

export async function claimResolution(env:Env,key:string,revision:number){
  const token=crypto.randomUUID(),stamp=Date.now(),seconds=Math.floor(stamp/1000),bucket=`public-music-resolution:${Math.floor(seconds/60)}`;
  const result=await env.DB.batch<{lease_token?:string;count?:number}>([
    env.DB.prepare('INSERT INTO music_resolutions(cache_key,source_revision,lease_token,lease_until) VALUES(?,?,?,?) ON CONFLICT(cache_key,source_revision) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until WHERE music_resolutions.lease_until<=? AND music_resolutions.expires_at<=? AND music_resolutions.failure_until<=? RETURNING lease_token').bind(key,revision,token,stamp+30000,stamp,stamp+5000,stamp),
    env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM music_resolutions WHERE cache_key=? AND source_revision=? AND lease_token=?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,seconds+120,key,revision,token),
  ]);
  if(result[0].results[0]?.lease_token!==token)return;
  const count=result[1].results[0]?.count;
  if(!count||count>180){
    await env.DB.prepare('UPDATE music_resolutions SET lease_until=0 WHERE cache_key=? AND source_revision=? AND lease_token=?').bind(key,revision,token).run();
    throw new HttpError(429,'操作较频繁，请稍后再试。','rate_limited');
  }
  return token;
}

export async function storeResolution(env:Env,key:string,revision:number,token:string,value:CachedResolution){
  await env.DB.prepare('UPDATE music_resolutions SET result_json=?,expires_at=?,lease_until=0,failure_until=0 WHERE cache_key=? AND source_revision=? AND lease_token=?').bind(JSON.stringify(value.resolved),value.expiresAt,key,revision,token).run();
}
export async function failResolution(env:Env,key:string,revision:number,token:string){
  // 同一首歌短暂失败时让等待者退出，避免接力重放整套取源。
  await env.DB.prepare('UPDATE music_resolutions SET lease_until=0,failure_until=? WHERE cache_key=? AND source_revision=? AND lease_token=?').bind(Date.now()+3000,key,revision,token).run();
}
