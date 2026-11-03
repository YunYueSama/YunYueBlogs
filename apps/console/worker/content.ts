import { kinds, type ContentDocument, type Metadata, type DocumentKind } from '../src/contracts';
import { HttpError, json, readJson, text } from './http';
import { validatePublicConfiguration } from './config-validation';

export type DocumentRow = { id: string; kind: DocumentKind; slug: string; title: string; body: string; metadata: string; publish: number; archived: number; revision: number; revision_token: string; created_at: string; updated_at: string };
export function toDocument(row: DocumentRow): ContentDocument {
  return { id: row.id, kind: row.kind, slug: row.slug, title: row.title, body: row.body, metadata: JSON.parse(row.metadata), publish: !!row.publish, archived: !!row.archived, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function validateDocument(input: Record<string, unknown>) {
  const kind = input.kind as DocumentKind;
  const slug = text(input.slug, 120);
  const title = text(input.title, 200);
  const body = typeof input.body === 'string' ? input.body : '';
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata as Metadata : {};
  if (!kinds.includes(kind) || !title || !slug || !/^[\p{L}\p{N}\p{M}_ .-]+$/u.test(slug) || slug.includes('..') || slug.startsWith('.')) throw new HttpError(400, '请填写标题和有效的地址名称，地址不能包含路径或特殊符号。');
  if (body.length > 200_000 || JSON.stringify(metadata).length > 20_000) throw new HttpError(413, '正文或附加信息过大。');
  if (metadata.date && (typeof metadata.date !== 'string' || !Number.isFinite(Date.parse(metadata.date)))) throw new HttpError(400, '日期格式不正确。');
  if (metadata.tags && (!Array.isArray(metadata.tags) || metadata.tags.length > 30 || metadata.tags.some(t => typeof t !== 'string' || t.length > 50))) throw new HttpError(400, '标签最多 30 个，每个不超过 50 字。');
  for (const key of ['cover', 'description', 'mood', 'location']) if (metadata[key] != null && typeof metadata[key] !== 'string') throw new HttpError(400, '附加信息格式不正确。');
  if (['projects', 'albums', 'friends', 'site', 'music'].includes(kind)) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new HttpError(400, '配置不是有效的 JSON，请修正后保存。'); }
    if (['site','music'].includes(kind) ? !parsed || typeof parsed !== 'object' || Array.isArray(parsed) : !Array.isArray(parsed)) throw new HttpError(400, '配置的数据结构不正确。');
    if (slug !== kind) throw new HttpError(400, '站点配置使用固定地址名称。');
    if (['site','music'].includes(kind)) validatePublicConfiguration(kind, parsed as Record<string,unknown>);
  }
  return { kind, slug, title, body, metadata, publish: input.publish === true ? 1 : 0 };
}
const revisionInsert = 'INSERT INTO document_revisions(document_id,revision,title,body,metadata,slug,publish,created_at) SELECT id,revision,title,body,metadata,slug,publish,updated_at FROM documents WHERE id=? AND revision_token=?';

export async function contentRoute(request: Request, env: Env, path: string): Promise<Response | undefined> {
  if (path === '/api/documents' && request.method === 'GET') {
    // 列表只读取正文短预览，避免浏览文稿时反复传输和处理全站正文。
    const rows = await env.DB.prepare("SELECT id,kind,slug,title,CASE WHEN kind='music' THEN '' WHEN kind IN ('site','projects','albums','friends') THEN body ELSE substr(body,1,2000) END AS body,metadata,publish,archived,revision,revision_token,created_at,updated_at FROM documents WHERE archived=0 ORDER BY updated_at DESC LIMIT 500").all<DocumentRow>();
    return json({ documents: rows.results.map(row => {
      const { body, ...summary } = toDocument(row);
      const plain = body.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]*>/g, '').replace(/[#*_>`\[\]]/g, '').replace(/\s+/g, ' ').trim();
      let excerpt=String(summary.metadata.description || plain).slice(0,180);
      if(['projects','albums','friends','site','music'].includes(summary.kind)) {
        excerpt=summary.kind==='music'?'原文、翻译、罗马音与时间偏移。':'进入可视化设置编辑公开配置。';
        try {
          const configured=JSON.parse(body);
          if(Array.isArray(configured)) {
            const items=configured.filter(item=>item&&typeof item==='object');
            excerpt=`已收录 ${items.length} 项：${items.slice(0,4).map(item=>item.name||item.title||'未命名').join(' · ')}`;
            const cover=items.find(item=>typeof item.cover==='string'&&item.cover)?.cover;
            if(cover)summary.metadata.cover=cover;
          } else if(configured&&typeof configured.description==='string')excerpt=configured.description;
        } catch { excerpt='配置格式需要检查，可进入高级源码继续编辑。'; }
      }
      return { ...summary, excerpt };
    }) });
  }
  if (path === '/api/documents' && request.method === 'POST') {
    const data = validateDocument(await readJson(request));
    const id = crypto.randomUUID(); const stamp = new Date().toISOString(); const nonce = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO documents(id,kind,slug,title,body,metadata,publish,revision_token,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, data.kind, data.slug, data.title, data.body, JSON.stringify(data.metadata), data.publish, nonce, stamp, stamp),
        env.DB.prepare(revisionInsert).bind(id, nonce),
      ]);
    } catch (error) { if (String(error).includes('UNIQUE')) throw new HttpError(409, '同类内容中已存在这个地址名称。', 'slug_conflict'); throw error; }
    return json(toDocument((await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(id).first<DocumentRow>())!), 201);
  }
  const match = /^\/api\/documents\/([a-zA-Z0-9-]+)$/.exec(path);
  if (!match) return;
  const id = match[1];
  const existing = await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(id).first<DocumentRow>();
  if (!existing) throw new HttpError(404, '没有找到这篇内容。');
  if (request.method === 'GET') return json(toDocument(existing));
  if (request.method === 'PUT') {
    const input = await readJson(request); const data = validateDocument(input);
    const revision = Number(input.revision);
    if (!Number.isSafeInteger(revision) || revision < 1 || data.kind !== existing.kind) throw new HttpError(400, '文档版本或类型不正确。');
    const nonce = crypto.randomUUID(); const stamp = new Date().toISOString();
    let result;
    try {
      result = await env.DB.batch([
        env.DB.prepare('UPDATE documents SET slug=?,title=?,body=?,metadata=?,publish=?,revision=revision+1,revision_token=?,updated_at=? WHERE id=? AND revision=? AND archived=0').bind(data.slug, data.title, data.body, JSON.stringify(data.metadata), data.publish, nonce, stamp, id, revision),
        env.DB.prepare(revisionInsert).bind(id, nonce),
      ]);
    } catch (error) { if (String(error).includes('UNIQUE')) throw new HttpError(409, '这个地址名称已被使用。', 'slug_conflict'); throw error; }
    if (!result[0].meta.changes) throw new HttpError(409, '其他设备已修改这篇内容。当前输入仍保留，请先比较云端版本。', 'revision_conflict');
    return json(toDocument((await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(id).first<DocumentRow>())!));
  }
}

export function publicFiles(documents: ContentDocument[], releaseId: string, hash: string): Record<string, string> {
  const files: Record<string, string> = {};
  const folders: Partial<Record<DocumentKind, string>> = { post: 'posts', chatter: 'chatters', moment: 'moments', page: 'content' };
  for (const doc of documents) {
    if (!doc.publish || doc.archived) continue;
    if (doc.body.includes('/api/media/') || JSON.stringify(doc.metadata).includes('/api/media/')) throw new HttpError(400, `「${doc.title}」还引用了私有素材，请先换为确认公开的图片地址。`);
    const folder = folders[doc.kind];
    if (folder) {
      const meta: Record<string, unknown> = { ...doc.metadata, title: doc.title, draft: false };
      if (doc.kind !== 'page' && !meta.date) meta.date = doc.createdAt;
      files[`${folder}/${doc.slug}.md`] = `---\n${Object.entries(meta).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${doc.body}\n`;
    } else files[`src/data/${doc.kind}.json`] = `${JSON.stringify(JSON.parse(doc.body), null, 2)}\n`;
  }
  files['public/release.json'] = JSON.stringify({ releaseId, snapshotHash: hash });
  return files;
}
