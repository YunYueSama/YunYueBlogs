import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';

export function publicAddress(value){try{return ipaddr.process(value).range()==='unicast';}catch{return false;}}
// 解析后固定目标 IP，并在每次跳转后重新校验；脚本不能访问云元数据或内网服务。
export async function publicRequest(raw,options={},budget={requests:0,bytes:0},signal,depth=0){
  const url=new URL(raw),host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port)||url.href.length>8192)throw new Error('invalid_destination');
  const abort=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(Math.min(10000,Math.max(500,Number(options.timeout)||8000)))]);
  abort.throwIfAborted();
  const dnsStarted=performance.now();
  const addresses=await new Promise((resolve,reject)=>{
    const stop=()=>reject(abort.reason);abort.addEventListener('abort',stop,{once:true});
    lookup(host,{all:true}).then(resolve,reject).finally(()=>abort.removeEventListener('abort',stop));
  });
  abort.throwIfAborted();
  if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw new Error('private_destination');
  const timing={dns:performance.now()-dnsStarted,connect:0,tls:0,wait:0};
  if(++budget.requests>50)throw new Error('request_limit');
  const headers={};for(const [key,value] of Object.entries(options.headers||{}))if(!/^(host|connection|content-length|proxy-authorization|proxy-connection|transfer-encoding)$/i.test(key)&&!/[\r\n]/.test(key+String(value)))headers[key]=String(value).slice(0,8192);
  let body=options.body;
  if(options.form){body=new URLSearchParams(options.form).toString();headers['Content-Type']='application/x-www-form-urlencoded';}
  if(body&&typeof body!=='string'){body=JSON.stringify(body);headers['Content-Type']='application/json';}
  if(body&&Buffer.byteLength(body)>65536)throw new Error('request_too_large');
  const maximum=Math.min(512000,Math.max(1,Number(options.maxBytes)||512000));
  const result=await new Promise((resolve,reject)=>{
    const started=performance.now();let connected=started,secure=started;
    const request=(url.protocol==='https:'?https:http).request(url,{method:options.method||'GET',headers,signal:abort,lookup:(_host,opt,callback)=>{const chosen=addresses.find(a=>a.family===4)||addresses[0];callback(null,opt.all?[chosen]:chosen.address,chosen.family);}},response=>{
      timing.wait=performance.now()-secure;
      const chunks=[];let size=0;
      response.on('data',part=>{size+=part.length;budget.bytes+=part.length;if(size>maximum||budget.bytes>3000000){request.destroy(new Error('response_too_large'));return;}chunks.push(part);});
      response.on('end',()=>resolve({statusCode:response.statusCode,headers:response.headers,raw:Buffer.concat(chunks)}));response.on('error',reject);
    });
    request.once('socket',socket=>{if(socket.connecting){socket.once('connect',()=>{connected=performance.now();timing.connect=connected-started;secure=connected;});socket.once('secureConnect',()=>{secure=performance.now();timing.tls=secure-connected;});}});
    request.on('error',reject);if(body)request.write(body);request.end();
  });
  if([301,302,303,307,308].includes(result.statusCode)&&result.headers.location){if(depth>=3)throw new Error('redirect_limit');const next=await publicRequest(new URL(result.headers.location,url),{...options,headers:{}},budget,signal,depth+1);for(const key of Object.keys(timing))timing[key]+=next.timing?.[key]||0;return {...next,timing};}
  const encoding=result.headers['content-encoding'];
  if(encoding==='gzip')result.raw=gunzipSync(result.raw,{maxOutputLength:maximum});
  else if(encoding==='deflate')result.raw=inflateSync(result.raw,{maxOutputLength:maximum});
  else if(encoding==='br')result.raw=brotliDecompressSync(result.raw,{maxOutputLength:maximum});
  let parsed=result.raw.toString('utf8');try{parsed=JSON.parse(parsed);}catch{}
  return {...result,url:url.href,body:parsed,timing};
}
