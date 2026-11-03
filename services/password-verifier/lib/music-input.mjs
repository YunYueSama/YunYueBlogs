import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// 内部脚本采用 gzip + Base64 传输；解压上限与原始音源导入上限一致。
export function createMusicInputDecoder(now=()=>Date.now()){
 const scripts=new Map();
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
    if(!cached||cached.expiresAt<=now()){scripts.delete(scriptSha256);throw new Error('source_cache_miss');}
    script=cached.script;
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
export const unpackMusicInput=createMusicInputDecoder();
