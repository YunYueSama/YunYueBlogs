import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { importStatements } from '../scripts/import-public.mjs';

let mf; let db;
beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local")}}',compatibilityDate:'2026-11-02',d1Databases:['DB']}));
  db=await mf.getD1Database('DB');
  await db.exec((await readFile(new URL('../migrations/0001_console.sql',import.meta.url),'utf8')).replace(/\n/g,' '));
});
afterAll(async()=>{await mf?.dispose();});
it('公开内容导入保留第一版，重跑不会覆盖云端编辑或修订',async()=>{
  const original={id:'import-note',kind:'post',slug:'import-note',title:'导入版本',body:'第一版正文',metadata:{},publish:true,createdAt:'2026-11-02',updatedAt:'2026-11-02'};
  const run=async()=>{for(const statement of importStatements([original]))await db.prepare(statement.sql).bind(...statement.params).run();};
  await run(); await run();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM document_revisions').first('n')).toBe(1);
  await db.prepare("UPDATE documents SET title='云端编辑',revision=2,revision_token='edited' WHERE id=?").bind(original.id).run();
  await run();
  expect(await db.prepare('SELECT title FROM documents WHERE id=?').bind(original.id).first('title')).toBe('云端编辑');
  expect(await db.prepare('SELECT body FROM document_revisions WHERE document_id=? AND revision=1').bind(original.id).first('body')).toBe(original.body);
});
