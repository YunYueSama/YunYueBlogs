import { HttpError } from './http';

type PrivateRow={ciphertext:string;revision:number};
async function key(env:Env){
  const raw=env.SETTINGS_ENCRYPTION_KEY;
  if(!raw||!/^[a-f0-9]{64}$/i.test(raw))throw new HttpError(503,'服务端尚未配置凭据加密密钥，请联系部署者。','encryption_unavailable');
  return crypto.subtle.importKey('raw',Uint8Array.from(raw.match(/../g)!,byte=>parseInt(byte,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function readPrivate<T>(env:Env,name:string):Promise<{value:T;revision:number}|null>{
  const row=await env.DB.prepare('SELECT ciphertext,revision FROM private_settings WHERE name=?').bind(name).first<PrivateRow>();
  if(!row)return null;
  try{const bytes=Uint8Array.from(atob(row.ciphertext),c=>c.charCodeAt(0));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(name)},await key(env),bytes.slice(12));return {value:JSON.parse(new TextDecoder().decode(plain)) as T,revision:row.revision};}
  catch{throw new HttpError(503,'服务端凭据无法解密，请核对部署的加密密钥。','decryption_unavailable');}
}
export async function writePrivate(env:Env,name:string,value:unknown,revision:number){
  const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},await key(env),new TextEncoder().encode(JSON.stringify(value))));
  const bytes=new Uint8Array(12+cipher.length);bytes.set(iv);bytes.set(cipher,12);const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
  const stamp=new Date().toISOString();
  const result=revision===0?await env.DB.prepare('INSERT OR IGNORE INTO private_settings(name,ciphertext,revision,updated_at) VALUES (?,?,1,?)').bind(name,encoded,stamp).run():await env.DB.prepare('UPDATE private_settings SET ciphertext=?,revision=revision+1,updated_at=? WHERE name=? AND revision=?').bind(encoded,stamp,name,revision).run();
  if(!result.meta.changes)throw new HttpError(409,'其他页面已更新该连接，请刷新后再保存。','revision_conflict');
  return revision+1;
}
