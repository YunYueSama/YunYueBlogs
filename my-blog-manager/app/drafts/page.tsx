'use client';

import { AlertTriangle, FilePlus2, LoaderCircle, Pencil, Search, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import PageHeader from '../../components/manager/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { managerApi } from '../../lib/managerApi';

type DraftSummary = {
  id: string;
  type: 'post' | 'chatter' | 'about';
  title: string;
  description?: string;
  contentPreview?: string;
  lastModified: number;
};

export default function DraftsPage() {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DraftSummary | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await managerApi<{ drafts: DraftSummary[] }>('/api/drafts');
      setDrafts(data.drafts || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '草稿读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  useEffect(() => {
    if (!pendingDelete) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removing) setPendingDelete(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [pendingDelete, removing]);

  const filteredDrafts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return drafts;
    return drafts.filter((draft) => [draft.title, draft.description, draft.contentPreview]
      .some((value) => value?.toLowerCase().includes(keyword)));
  }, [drafts, query]);

  const removeDraft = async () => {
    if (!pendingDelete || removing) return;
    setRemoving(pendingDelete.id);
    try {
      await managerApi(`/api/drafts/${encodeURIComponent(pendingDelete.id)}`, { method: 'DELETE' });
      setDrafts((current) => current.filter((draft) => draft.id !== pendingDelete.id));
      showToast('草稿已从本地工作区移除', 'success');
      setPendingDelete(null);
    } catch (deleteError) {
      showToast(deleteError instanceof Error ? deleteError.message : '草稿删除失败', 'error');
    } finally {
      setRemoving(null);
    }
  };

  return <>
    <PageHeader
      eyebrow="Local draft workspace"
      title="草稿箱"
      description="草稿只保存在本机 workspace，不会进入管理端仓库或公开站点。"
      actions={<><Link className="console-action secondary" href="/editor?type=chatter"><FilePlus2 size={16} />新建杂谈</Link><Link className="console-action" href="/editor?type=post"><FilePlus2 size={16} />新建文章</Link></>}
    />

    <section className="console-panel">
      <header><div><h2>未发布内容</h2><span>{drafts.length} 份本地草稿</span></div></header>
      <div className="structured-toolbar">
        <label className="media-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、摘要或正文" /></label>
        <button className="console-action secondary" type="button" onClick={() => void loadDrafts()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}刷新</button>
      </div>

      {error && <div className="form-status error" role="alert">{error}</div>}
      {loading ? <div className="structured-empty"><LoaderCircle className="animate-spin" size={24} /><span>正在读取本地草稿</span></div> : filteredDrafts.length ? <div className="draft-grid">{filteredDrafts.map((draft) => <article className="draft-card" key={draft.id}>
        <div className="draft-card-meta"><span>{draft.type === 'chatter' ? '杂谈' : draft.type === 'about' ? '关于' : '文章'}</span><time>{formatDate(draft.lastModified)}</time></div>
        <div><h3>{draft.title || '无标题草稿'}</h3><p>{draft.contentPreview || draft.description || '尚未写入正文'}</p></div>
        <footer><Link className="console-action secondary" href={`/editor?id=${encodeURIComponent(draft.id)}&type=${draft.type}`}><Pencil size={15} />继续编辑</Link><button className="console-icon danger" type="button" onClick={() => setPendingDelete(draft)} aria-label={`删除${draft.title || '无标题草稿'}`}><Trash2 size={16} /></button></footer>
      </article>)}</div> : <div className="structured-empty"><FilePlus2 size={28} /><strong>{query ? '没有匹配的草稿' : '草稿箱是空的'}</strong><span>{query ? '换一个关键词试试。' : '在编辑器中保存草稿后，它会出现在这里。'}</span></div>}
    </section>

    {pendingDelete && createPortal(<div className="console-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !removing) setPendingDelete(null); }}>
      <section className="console-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-draft-title">
        <header><div><span>DESTRUCTIVE ACTION</span><h2 id="delete-draft-title">删除本地草稿</h2></div><button className="console-icon" type="button" onClick={() => setPendingDelete(null)} disabled={Boolean(removing)} aria-label="关闭"><X size={18} /></button></header>
        <div className="console-dialog-body"><AlertTriangle size={28} color="var(--console-coral)" /><p>将删除“{pendingDelete.title || '无标题草稿'}”的草稿副本。已发布的文章或杂谈不会受到影响。</p></div>
        <footer><button className="console-action secondary" type="button" onClick={() => setPendingDelete(null)} disabled={Boolean(removing)}>取消</button><button className="console-action danger" type="button" onClick={() => void removeDraft()} disabled={Boolean(removing)}>{removing ? <LoaderCircle className="animate-spin" size={16} /> : <Trash2 size={16} />}确认删除</button></footer>
      </section>
    </div>, document.body)}
  </>;
}

function formatDate(timestamp: number) {
  if (!Number.isFinite(timestamp)) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}
