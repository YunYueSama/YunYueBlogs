import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const appRoot = fileURLToPath(new URL('../',import.meta.url));
export async function readPublicContent(blogPath=resolve(appRoot,'../../YunYueBlog')) {
  const documents=[]; const stamp=new Date().toISOString();
  for(const [folder,kind] of [['posts','post'],['chatters','chatter'],['moments','moment'],['content','page']]) {
    for(const name of (await readdir(resolve(blogPath,folder))).filter(name=>name.endsWith('.md')).sort()) {
      const source=await readFile(resolve(blogPath,folder,name),'utf8'); const parsed=matter(source);
      if(parsed.data.draft===true) continue;
      const slug=basename(name,'.md'); const digest=createHash('sha256').update(`${kind}/${slug}`).digest('hex');
      const metadata={...parsed.data};delete metadata.title;delete metadata.draft;
      if(metadata.date instanceof Date)metadata.date=metadata.date.toISOString();
      documents.push({id:`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`,kind,slug,title:parsed.data.title||`${slug} / 说说`,body:parsed.content,metadata,publish:true,createdAt:stamp,updatedAt:stamp,revision:1});
    }
  }
  for(const [kind,title] of [['site','站点配置'],['projects','作品集'],['albums','相册'],['friends','友链'],['music','歌词配置']]) {
    const body=await readFile(resolve(blogPath,'src/data',kind+'.json'),'utf8'); JSON.parse(body);
    documents.push({id:`config-${kind}`,kind,slug:kind,title,body,metadata:{},publish:true,createdAt:stamp,updatedAt:stamp,revision:1});
  }
  return documents;
}
export function importStatements(documents) {
  return documents.flatMap(doc=>[
    {sql:'INSERT OR IGNORE INTO documents(id,kind,slug,title,body,metadata,publish,revision_token,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',params:[doc.id,doc.kind,doc.slug,doc.title,doc.body,JSON.stringify(doc.metadata),doc.publish?1:0,doc.id,doc.createdAt,doc.updatedAt]},
    // 初始版本也要保留修订；重复导入不能覆盖已有编辑或生成虚假的第一版。
    {sql:'INSERT OR IGNORE INTO document_revisions(document_id,revision,title,body,metadata,slug,publish,created_at) SELECT id,revision,title,body,metadata,slug,publish,updated_at FROM documents WHERE id=? AND revision=1 AND revision_token=?',params:[doc.id,doc.id]},
  ]);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('请传入被忽略的导入批次输出路径。该脚本只读取公开博客白名单目录。');
  const docs=await readPublicContent(process.env.PUBLIC_BLOG_PATH);
  await writeFile(resolve(process.argv[2]),JSON.stringify(importStatements(docs)),'utf8');
  console.log(JSON.stringify({documents:docs.length,mode:'prepare-only',credentialsIncluded:false}));
}
