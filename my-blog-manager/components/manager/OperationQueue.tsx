'use client';

import { CheckCircle2, Inbox, LoaderCircle, Play, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOperations } from '../../context/OperationContext';
import { useToast } from '../ToastProvider';

const labels = {
  content_upsert: '内容', content_delete: '删除内容', moment_upsert: '说说', moment_delete: '删除说说',
  projects_update: '项目', gallery_update: '相册', friends_update: '友链', settings_update: '设置',
};

export default function OperationQueue() {
  const router = useRouter();
  const { showToast } = useToast();
  const { operations, removeOperation, clearOperations, applyOperations, hydrated, saving, error, retrySave } = useOperations();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const apply = async () => {
    if (!operations.length || applying) return;
    setApplying(true);
    try {
      const result = await applyOperations();
      showToast(`已应用 ${result.count} 项操作到本地工作区`, 'success');
      setOpen(false);
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '队列应用失败', 'error');
    } finally {
      setApplying(false);
    }
  };

  return <>
    <button className="console-icon operation-trigger" type="button" onClick={() => setOpen(true)} aria-label={`打开操作队列，共 ${operations.length} 项`} title="操作队列">
      <Inbox size={18} />{operations.length > 0 && <span>{operations.length > 99 ? '99+' : operations.length}</span>}
    </button>
    {open && createPortal(<div className="queue-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <aside className="queue-drawer" role="dialog" aria-modal="true" aria-labelledby="queue-title">
        <header><div><span>{saving ? '正在保存' : '本地操作队列'}</span><h2 id="queue-title">待应用操作</h2></div><button className="console-icon" type="button" onClick={() => setOpen(false)} aria-label="关闭操作队列"><X size={18} /></button></header>
        {error && <div className="form-status error" role="alert">{error}<button className="console-action secondary" type="button" onClick={() => void retrySave().catch(() => undefined)} disabled={saving || applying}>重试连接与保存</button></div>}
        <div className="queue-list">{!hydrated ? <div className="queue-empty"><LoaderCircle className="animate-spin" /><span>正在读取本地队列</span></div> : operations.length ? operations.map((operation) => <article key={operation.id}><span>{labels[operation.type]}</span><div><strong>{operation.label}</strong><small>{operation.description || new Date(operation.timestamp).toLocaleString()}</small></div><button type="button" onClick={() => removeOperation(operation.id)} disabled={applying} aria-label={`移除${operation.label}`} title="移除"><Trash2 size={15} /></button></article>) : <div className="queue-empty"><CheckCircle2 size={26} /><strong>队列是空的</strong><span>编辑内容或资料后，待应用操作会出现在这里。</span></div>}</div>
        <footer><button className="console-action secondary" type="button" onClick={clearOperations} disabled={!hydrated || !operations.length || applying}><Trash2 size={16} />清空</button><button className="console-action" type="button" onClick={() => void apply()} disabled={!hydrated || !operations.length || applying}>{applying ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}应用到工作区</button></footer>
      </aside>
    </div>, document.body)}
  </>;
}
