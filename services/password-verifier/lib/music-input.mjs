import {gunzipSync,brotliDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// 内部脚本采用 gzip + Base64 传输；解压上限与原始音源导入上限一致。
export function createMusicInputDecoder(now=()=>Date.now(),snapshot){
 const scripts=new Map();
 let pinned;
 // 私有快照只提供源码，不能执行代码；配置失效时仍保留正常补传路径。
 try{
   if(typeof snapshot==='string'&&snapshot.length<=60000){
     const value=JSON.parse(snapshot);
     if(/^[a-f0-9]{64}$/.test(value.sha256)&&typeof value.brotli==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(value.brotli)){
       const script=brotliDecompressSync(Buffer.from(value.brotli,'base64'),{maxOutputLength:256000}).toString('utf8');
       if(createHash('sha256').update(script).digest('hex')===value.sha256)pinned={script,hash:value.sha256};
     }
   }
 }catch{}
 return function unpack(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_input');
  const {scriptGzip,scriptSha256,...rest}=input;
  if(scriptSha256!==undefined&&(typeof scriptSha256!=='string'||!/^[a-f0-9]{64}$/.test(scriptSha256)))throw new Error('invalid_input');
  let script=input.script;
  if(Object.hasOwn(input,'scriptGzip')){
    if(Object.hasOwn(input,'script')||typeof scriptGzip!=='string'||!scriptGzip||scriptGzip.length>350000||scriptGzip.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(scriptGzip))throw new Error('invalid_input');
    try{script=gunzipSync(Buffer.from(scriptGzip,'base64'),{maxOutputLength:256000}).toString('utf8');}catch{throw new Error('invalid_input');}
  }
  if(script===undefined&&scriptSha256){
    const cached=scripts.get(scriptSha256);
    if(cached&&cached.expiresAt>now())script=cached.script;
    else if(pinned?.hash===scriptSha256)script=pinned.script;
    else{scripts.delete(scriptSha256);throw new Error('source_cache_miss');}
  }
  if(typeof script==='string'){
    if(Buffer.byteLength(script)>256000)throw new Error('invalid_input');
    const hash=createHash('sha256').update(script).digest('hex');
    if(scriptSha256&&hash!==scriptSha256)throw new Error('invalid_input');
    // 只缓存不可变源码；每次取源依然创建独立沙箱，不复用脚本全局状态。
    scripts.delete(hash);scripts.set(hash,{script,expiresAt:now()+15*60000});
    if(scripts.size>4)scripts.delete(scripts.keys().next().value);
    return {...rest,script};
  }
  if(scriptSha256)throw new Error('invalid_input');
  return input;
 };
}
export const unpackMusicInput=createMusicInputDecoder(undefined,process.env.MUSIC_SOURCE_SNAPSHOT);
