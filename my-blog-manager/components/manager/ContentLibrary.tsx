'use client';

import { useMemo, useState } from 'react';
import { Pencil, Search } from 'lucide-react';
import Link from 'next/link';

type Document = { id: string; type: string; title: string; date: string; description: string; tags: string[] };
const PAGE_SIZE = 20;

export default function ContentLibrary({ documents }: { documents: Document[] }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => documents.filter((document) =>
    (type === 'all' || document.type === type) &&
    `${document.title} ${document.description} ${document.tags.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ), [documents, query, type]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return <section className="console-panel">
    <header><div><h2>内容库</h2><span>共 {documents.length} 篇内容 · 筛选结果 {filtered.length} 篇</span></div></header>
    <div className="content-library-tools">
      <label className="media-search"><Search size={17} /><input aria-label="搜索内容" placeholder="搜索标题、摘要或标签" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      <select aria-label="内容类型" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="all">全部类型</option><option value="post">文章</option><option value="chatter">杂谈</option></select>
    </div>
    {visible.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>标题</th><th>类型</th><th>日期</th><th>标签</th><th>编辑</th></tr></thead><tbody>{visible.map((document) => <tr key={`${document.type}-${document.id}`}><td className="title-cell"><Link href={`/editor?id=${encodeURIComponent(document.id)}&type=${document.type}`}>{document.title}</Link><span>{document.description || '没有摘要'}</span></td><td>{document.type === 'post' ? '文章' : '杂谈'}</td><td>{document.date || '未设置'}</td><td>{document.tags.slice(0, 3).join(' / ') || '—'}</td><td><Link className="console-icon" href={`/editor?id=${encodeURIComponent(document.id)}&type=${document.type}`} aria-label={`编辑${document.title}`}><Pencil size={16} /></Link></td></tr>)}</tbody></table></div> : <div className="structured-empty"><Search size={25} /><strong>{documents.length ? '没有匹配的内容' : '还没有内容'}</strong><span>{documents.length ? '尝试其他关键词或切换内容类型。' : '新建文章，或从原有博客迁移内容。'}</span></div>}
    <footer className="content-pagination"><span>第 {current} / {pages} 页</span><button className="console-action secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>上一页</button><button className="console-action secondary" disabled={current >= pages} onClick={() => setPage(current + 1)}>下一页</button></footer>
  </section>;
}
