import { FilePlus2, MessageCircle, Pencil, Search } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '../../components/manager/PageHeader';
import { listDocuments } from '../../lib/workspaceData';

export const dynamic = 'force-dynamic';

export default function ContentPage() {
  const documents = [...listDocuments('posts'), ...listDocuments('chatters')].sort((a, b) => b.date.localeCompare(a.date));
  return <>
    <PageHeader eyebrow="Content workspace" title="内容" description="统一浏览文章与杂谈；草稿、已发布内容和本地文件使用同一套元数据。" actions={<><Link className="console-action secondary" href="/moments"><MessageCircle size={16} />说说</Link><Link className="console-action secondary" href="/drafts">草稿箱</Link><Link className="console-action" href="/editor"><FilePlus2 size={16} />新建内容</Link></>} />
    <section className="console-panel"><header><div><h2>内容库</h2><span>{documents.length} 个文档</span></div><span><Search size={16} /> 搜索由编辑器与列表筛选共同提供</span></header>{documents.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>标题</th><th>类型</th><th>日期</th><th>标签</th><th>操作</th></tr></thead><tbody>{documents.map((document) => <tr key={`${document.type}-${document.id}`}><td className="title-cell">{document.title}<span>{document.description || '没有摘要'}</span></td><td>{document.type === 'post' ? '文章' : '杂谈'}</td><td>{document.date || '未设置'}</td><td>{document.tags.slice(0, 3).join(' / ') || '—'}</td><td><Link className="console-icon" href={`/editor?id=${encodeURIComponent(document.id)}&type=${document.type}`} aria-label={`编辑${document.title}`}><Pencil size={16} /></Link></td></tr>)}</tbody></table></div> : <div className="form-status">工作区暂无内容。先迁移旧内容或新建一篇文章。</div>}</section>
  </>;
}
