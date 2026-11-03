import {gunzipSync} from 'node:zlib';

// 内部脚本采用 gzip + Base64 传输；解压上限与原始音源导入上限一致。
export function unpackMusicInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_input');
  if(!Object.hasOwn(input,'scriptGzip'))return input;
  const encoded=input.scriptGzip;
  if(Object.hasOwn(input,'script')||typeof encoded!=='string'||!encoded||encoded.length>350000||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('invalid_input');
  let script;try{script=gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:256000}).toString('utf8');}catch{throw new Error('invalid_input');}
  const {scriptGzip,...rest}=input;return {...rest,script};
}
