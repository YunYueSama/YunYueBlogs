import {validMusicId} from '../src/music-channels';
import {HttpError,json} from './http';
export type DeliveryEnv=Pick<Env,'DB'|'MUSIC_DELIVERY_KEY'|'MUSIC_DELIVERY_BUDGET_BYTES'|'SITE_URL'>;
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
const encode=(b:Uint8Array)=>btoa(Array.from(b,c=>String.fromCharCode(c)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function signingKey(env:DeliveryEnv,uses:KeyUsage[]){const raw=env.MUSIC_DELIVERY_KEY;if(!raw||!/^[a-f0-9]{64}$/i.test(raw))throw new HttpError(503,'边缘音乐服务尚未配置。');return crypto.subtle.importKey('raw',Uint8Array.from(raw.match(/../g)!,v=>parseInt(v,16)),{name:'HMAC',hash:'SHA-256'},false,uses);}
export async function issueMusicTicket(env:DeliveryEnv,data:Record<string,unknown>){const ticket=encode(new TextEncoder().encode(JSON.stringify(data)));const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env,['sign']),new TextEncoder().encode(ticket))));return {ticket,signature};}
export async function verifyMusicTicket(env:DeliveryEnv,ticket:string,signature:string):Promise<Record<string,unknown>>{
  if(!ticket||ticket.length>8000||!signature||signature.length>100)throw new HttpError(403,'播放票据无效，请刷新歌单。');
  const key=await signingKey(env,['verify']);
  try{if(!await crypto.subtle.verify('HMAC',key,decode(signature),new TextEncoder().encode(ticket)))throw new Error();const data=JSON.parse(new TextDecoder().decode(decode(ticket)));const now=Math.floor(Date.now()/1000);if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isSafeInteger(data.exp)||data.exp<now||data.exp>now+1200)throw new Error();return data;}catch{throw new HttpError(403,'播放票据已失效，请刷新歌单。');}
}
export const allowedMediaHost=(host:string,source:string)=>source==='netease'?host.endsWith('.music.126.net'):source==='kugou'?['fsandroid.tx.kugou.com','fs.youthandroid.kugou.com','fs.youthandroid2.kugou.com'].includes(host):source==='qq'?(host.endsWith('.stream.qqmusic.qq.com')||host==='wx.music.tc.qq.com'):source==='kuwo'?host.endsWith('.kuwo.cn'):source==='migu'?host.endsWith('.migu.cn'):false;
export async function deliveryRoute(request:Request,env:DeliveryEnv,path:string):Promise<Response|undefined>{
  if(path!=='/public/music/stream')return;
  if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'请求方式不正确。');
  const url=new URL(request.url),data=await verifyMusicTicket(env,url.searchParams.get('ticket')||'',url.searchParams.get('signature')||'');
  const {source,id,quality}=data;
  if(typeof source!=='string'||!validMusicId(source,id)||!['320 kbps','128 kbps','FLAC 无损'].includes(String(quality)))throw new HttpError(403,'歌曲票据不正确。');
  let upstream:URL;try{upstream=new URL(String(data.url));}catch{throw new HttpError(403,'音频地址不受支持。');}
  if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password||upstream.port||!allowedMediaHost(upstream.hostname,source))throw new HttpError(403,'音频地址不受支持。');
  const max=quality==='FLAC 无损'?128000000:32000000;
  if(data.size!==undefined&&(!Number.isSafeInteger(data.size)||Number(data.size)<1||Number(data.size)>max))throw new HttpError(403,'音频大小不受支持。');
  const configured=Number(env.MUSIC_DELIVERY_BUDGET_BYTES||'0');if(!Number.isSafeInteger(configured)||configured<0)throw new HttpError(503,'播放预算配置不正确。');
  const now=Math.floor(Date.now()/1000),day=Math.floor(now/86400),origin=request.headers.get('origin')||'';
  const cors=origin===env.SITE_URL||url.hostname==='127.0.0.1'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)?origin:env.SITE_URL;
  const common={'Access-Control-Allow-Origin':cors,'Access-Control-Expose-Headers':'Content-Range, Accept-Ranges','Vary':'Origin'};
  if(url.searchParams.get('status')==='true'){
    const usage=await env.DB.prepare("SELECT COALESCE(SUM(count),0) AS bytes FROM rate_limits WHERE key LIKE 'delivery-bytes:%' AND expires_at>?").bind(now).first<{bytes:number}>();
    if(configured&&(usage?.bytes||0)+65536>configured)throw new HttpError(429,'本站播放预算暂时不足，请稍后再试。');return json({available:true},200,common);
  }
  // 独立于字节预算的请求保护，给同账号的管理服务保留空间；不是 Cloudflare 用量统计。
  const requestQuota=await env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<40000 RETURNING count').bind(`delivery-requests:${day}`,(day+2)*86400).first();
  if(!requestQuota)throw new HttpError(429,'本站今日播放请求已达到保护阈值，请稍后再试。');
  const range=request.headers.get('range');if(range&&!/^bytes=(\d+-\d*|-\d+)$/.test(range))throw new HttpError(416,'播放范围无效。');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);let response:Response;
  try{response=await fetch(upstream,{method:request.method,headers:range?{Range:range}:{},redirect:'manual',signal:AbortSignal.any([request.signal,controller.signal])});}catch{throw new HttpError(502,'音频连接暂时不可用，请刷新后重试。');}finally{clearTimeout(timer);}
  const length=Number(response.headers.get('content-length'));
  if(![200,206].includes(response.status)||!Number.isSafeInteger(length)||length<=0||length>max||response.headers.has('content-encoding')&&response.headers.get('content-encoding')!=='identity'){await response.body?.cancel();throw new HttpError(502,'音频响应暂时不可用。');}
  if(data.size!==undefined){const total=response.status===206?Number((response.headers.get('content-range')||'').split('/')[1]):length;if(total!==data.size){await response.body?.cancel();throw new HttpError(502,'音频资源已变化，请刷新歌单。');}}
  const headers=new Headers({...common,'Content-Type':quality==='FLAC 无损'?'audio/flac':'audio/mpeg','Content-Length':String(length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  for(const name of ['content-range','accept-ranges']){const value=response.headers.get(name);if(value)headers.set(name,value);}
  if(request.method==='HEAD')return new Response(null,{status:response.status,headers});
  if(!response.body)throw new HttpError(502,'音频正文暂时不可用。');
  const amount=Math.max(65536,length+4096);
  const reserved=await env.DB.prepare("INSERT INTO rate_limits(key,count,expires_at) SELECT ?,?,? WHERE ?=0 OR (SELECT COALESCE(SUM(count),0) FROM rate_limits WHERE key LIKE 'delivery-bytes:%' AND expires_at>?)+?<=? ON CONFLICT(key) DO UPDATE SET count=count+excluded.count RETURNING count").bind(`delivery-bytes:${day}`,amount,(day+31)*86400,configured,now,amount,configured).first();
  if(!reserved){await response.body.cancel();throw new HttpError(429,'本站播放预算暂时不足，请稍后再试。');}
  let sent=0;const reader=response.body.getReader();
  return new Response(new ReadableStream({async pull(output){try{const {done,value}=await reader.read();if(done){if(sent!==length)throw new Error();output.close();return;}const part=value.subarray(0,length-sent);sent+=part.length;output.enqueue(part);if(sent===length){output.close();await reader.cancel();}}catch{controller.abort();output.error(new Error('音频连接已中断，请重试。'));}},async cancel(){controller.abort();await reader.cancel();}}),{status:response.status,headers});
}
