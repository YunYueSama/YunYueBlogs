import {HttpError} from './http';
import {allowedMediaHost} from './music-delivery';
import type {ResolvedMusic} from './music-sources';

export function validateResolution(track:{source:string},resolved:ResolvedMusic){
  if(!resolved||!Number.isSafeInteger(resolved.size)||resolved.size<1||resolved.size>128000000||!['audio/mpeg','audio/flac'].includes(resolved.mime))throw new HttpError(502,'音频格式暂不受支持。');
  const upstream=new URL(resolved.url);
  if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password||upstream.port||!allowedMediaHost(upstream.hostname,track.source))throw new HttpError(502,'平台音频地址不受支持。');
  return upstream;
}
