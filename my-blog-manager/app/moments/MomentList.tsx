'use client';
/* eslint-disable @next/next/no-img-element -- Moment images use runtime-configured media hosts. */

import { Clock3, Image as ImageIcon, MapPin, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog, ConsoleDialog } from '../../components/manager/ConsoleDialog';
import MediaPicker from '../../components/manager/MediaPicker';
import PageHeader from '../../components/manager/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { useOperations } from '../../context/OperationContext';
import type { MomentRecord as Moment } from '../../lib/operationTypes';

const emptyMoment = (): Moment => ({ id: '', date: localDateTime(new Date().toISOString()), content: '', location: '', images: [] });

export default function MomentList({ moments: initialMoments }: { moments: Moment[]; authorName?: string; avatarUrl?: string }) {
  const { addOperation } = useOperations();
  const { showToast } = useToast();
  const [moments, setMoments] = useState(initialMoments);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Moment | null>(null);
  const [deleting, setDeleting] = useState<Moment | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return moments;
    return moments.filter((moment) => [moment.content, moment.location, moment.date].some((value) => value.toLowerCase().includes(keyword)));
  }, [moments, query]);

  const save = () => {
    if (!editing) return;
    const content = editing.content.trim();
    if (!content || !editing.date) { setFormError('正文和时间不能为空。'); return; }
    if (editing.images.length > 12) { setFormError('每条说说最多添加 12 张图片。'); return; }
    const record = { ...editing, id: editing.id || `moment_${Date.now()}`, content, date: new Date(editing.date).toISOString() };
    const exists = moments.some((moment) => moment.id === record.id);
    setMoments((current) => exists ? current.map((moment) => moment.id === record.id ? record : moment) : [record, ...current]);
    addOperation({ id: `moment_op_${record.id}`, type: 'moment_upsert', label: `${exists ? '更新' : '发布'}说说`, description: content.slice(0, 80), payload: record });
    showToast('说说变更已加入操作队列', 'info');
    setEditing(null);
  };

  const remove = () => {
    if (!deleting) return;
    setMoments((current) => current.filter((moment) => moment.id !== deleting.id));
    addOperation({ id: `moment_op_${deleting.id}`, type: 'moment_delete', label: '删除说说', description: deleting.content.slice(0, 80), payload: { id: deleting.id } });
    showToast('删除操作已加入队列', 'info');
    setDeleting(null);
  };

  return <>
    <PageHeader eyebrow="Short-form content" title="说说" description="管理短动态、地点与图片；所有发布和删除操作均先进入本地队列。" actions={<button className="console-action" type="button" onClick={() => { setFormError(''); setEditing(emptyMoment()); }}><Plus size={16} />发布说说</button>} />
    <section className="console-panel">
      <header><div><h2>动态列表</h2><span>{moments.length} 条说说</span></div></header>
      <div className="structured-toolbar"><label className="media-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索正文、地点或日期" /></label><span className="integration-badge"><span className="status-dot" />队列保存</span></div>
      {filtered.length ? <div className="moment-record-list">{filtered.map((moment) => <article key={moment.id}>
        <header><div><span><Clock3 size={14} />{formatDate(moment.date)}</span>{moment.location && <span><MapPin size={14} />{moment.location}</span>}</div><div><button className="console-icon" type="button" onClick={() => { setFormError(''); setEditing({ ...moment, date: localDateTime(moment.date), images: [...moment.images] }); }} aria-label="编辑说说"><Pencil size={15} /></button><button className="console-icon danger" type="button" onClick={() => setDeleting(moment)} aria-label="删除说说"><Trash2 size={15} /></button></div></header>
        <p>{moment.content}</p>
        {moment.images.length > 0 && <div className="moment-images">{moment.images.map((image, index) => <img src={image} alt="" loading="lazy" key={`${image}-${index}`} />)}</div>}
        <footer>{moment.id}</footer>
      </article>)}</div> : <div className="structured-empty"><Clock3 size={28} /><strong>{query ? '没有匹配的说说' : '还没有说说'}</strong><span>{query ? '换一个关键词试试。' : '发布后会先进入操作队列。'}</span></div>}
    </section>

    <ConsoleDialog open={Boolean(editing)} eyebrow="MOMENT RECORD" title={editing?.id ? '编辑说说' : '发布说说'} onClose={() => setEditing(null)} wide footer={<><button className="console-action secondary" type="button" onClick={() => setEditing(null)}>取消</button><button className="console-action" type="button" onClick={save}>加入队列</button></>}>
      {editing && <div className="console-form"><div className="form-grid"><label className="form-field"><span>时间</span><input type="datetime-local" value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} /></label><label className="form-field"><span>地点</span><input value={editing.location} maxLength={200} onChange={(event) => setEditing({ ...editing, location: event.target.value })} placeholder="可选" /></label><label className="form-field full"><span>正文</span><textarea value={editing.content} maxLength={20000} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></label><div className="form-field full"><span>图片（{editing.images.length}/12）</span><div className="moment-image-editor">{editing.images.map((image, index) => <div key={`${image}-${index}`}><img src={image} alt="" /><button type="button" onClick={() => setEditing({ ...editing, images: editing.images.filter((_, imageIndex) => imageIndex !== index) })} aria-label="移除图片"><X size={13} /></button></div>)}{editing.images.length < 12 && <button type="button" onClick={() => setMediaOpen(true)}><ImageIcon size={20} /><span>媒体库</span></button>}</div></div></div>{formError && <div className="form-status error" role="alert">{formError}</div>}</div>}
    </ConsoleDialog>
    <MediaPicker open={mediaOpen} onClose={() => setMediaOpen(false)} onSelect={(url) => setEditing((current) => current && !current.images.includes(url) ? { ...current, images: [...current.images, url] } : current)} />
    <ConfirmDialog open={Boolean(deleting)} title="删除说说" description="该说说将在操作队列应用后从本地工作区删除；应用前可以清空队列取消。" onClose={() => setDeleting(null)} onConfirm={remove} />
  </>;
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
