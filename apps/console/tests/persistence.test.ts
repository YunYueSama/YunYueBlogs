import {expect,it} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {localPersistence} from '../scripts/local-persistence.mjs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

it('人工预览跨运行器重启保留改密状态、文稿和加密连接，自动验收不落入人工库',async()=>{
  const parent=resolve('.cloudflare/persistence-tests');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(resolve(parent,'run-'));
  const options=()=>convertV4MiniflareOptions({...localPersistence(directory,true),modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-11-03',d1Databases:['DB'],r2Buckets:['MEDIA']});
  let mf:Miniflare|undefined;
  try{
    expect(localPersistence(directory,false)).toEqual({});
    mf=new Miniflare(options());let db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE review_state(id TEXT PRIMARY KEY,value TEXT);');
    for(const [id,value] of [['password_version','2'],['document','重启保留稿'],['encrypted_connection','ciphertext-only']])await db.prepare('INSERT INTO review_state VALUES (?,?)').bind(id,value).run();
    const bucket=await mf.getR2Bucket('MEDIA');await bucket.put('private-test','test-only');
    await mf.dispose();mf=undefined;
    mf=new Miniflare(options());db=await mf.getD1Database('DB');
    expect((await db.prepare('SELECT value FROM review_state WHERE id=?').bind('password_version').first<{value:string}>())?.value).toBe('2');
    expect((await db.prepare('SELECT value FROM review_state WHERE id=?').bind('document').first<{value:string}>())?.value).toBe('重启保留稿');
    expect((await db.prepare('SELECT value FROM review_state WHERE id=?').bind('encrypted_connection').first<{value:string}>())?.value).toBe('ciphertext-only');
    expect(await (await (await mf.getR2Bucket('MEDIA')).get('private-test'))?.text()).toBe('test-only');
  }finally{await mf?.dispose();if(!directory.startsWith(parent+sep))throw Error('invalid_cleanup_path');await rm(directory,{recursive:true,force:true});}
},30000);
