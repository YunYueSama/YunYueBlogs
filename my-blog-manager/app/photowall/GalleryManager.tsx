'use client';
/* eslint-disable @next/next/no-img-element -- Gallery media hosts are configured at runtime. */

import { Image as ImageIcon, Images, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog, ConsoleDialog } from '../../components/manager/ConsoleDialog';
import MediaPicker from '../../components/manager/MediaPicker';
import PageHeader from '../../components/manager/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { useOperations } from '../../context/OperationContext';
import type { AlbumRecord as Album, PhotoRecord as Photo } from '../../lib/operationTypes';

const emptyAlbum = (): Album => ({ id: '', title: '', description: '', cover: '', date: new Date().toISOString().slice(0, 10), photos: [] });
const emptyPhoto = (): Photo => ({ url: '', caption: '' });

export default function GalleryManager({ initialAlbums }: { initialAlbums: Album[] }) {
  const { addOperation } = useOperations();
  const { showToast } = useToast();
  const [albums, setAlbums] = useState(initialAlbums);
  const [selectedId, setSelectedId] = useState(initialAlbums[0]?.id || '');
  const [query, setQuery] = useState('');
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<{ index: number | null; value: Photo } | null>(null);
  const [deleting, setDeleting] = useState<{ type: 'album' | 'photo'; title: string; index?: number; id?: string } | null>(null);
  const [mediaTarget, setMediaTarget] = useState<'album' | 'photo' | null>(null);
  const [formError, setFormError] = useState('');

  const selected = albums.find((album) => album.id === selectedId) || null;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return albums;
    return albums.filter((album) => [album.title, album.description, album.date].some((value) => value.toLowerCase().includes(keyword)));
  }, [albums, query]);
  const photoCount = albums.reduce((total, album) => total + album.photos.length, 0);

  const stage = (next: Album[], label: string) => {
    setAlbums(next);
    addOperation({ id: `gallery_${Date.now()}`, type: 'gallery_update', label, description: `${next.length} 个相册、${next.reduce((sum, album) => sum + album.photos.length, 0)} 张照片将写入本地工作区`, payload: { albums: next } });
    showToast('相册变更已加入操作队列', 'info');
  };

  const saveAlbum = () => {
    if (!editingAlbum) return;
    const title = editingAlbum.title.trim();
    const cover = editingAlbum.cover.trim();
    if (!title || !cover) { setFormError('相册标题和封面不能为空。'); return; }
    const record = { ...editingAlbum, id: editingAlbum.id || `album_${Date.now()}`, title, cover };
    const exists = albums.some((album) => album.id === record.id);
    const next = exists ? albums.map((album) => album.id === record.id ? record : album) : [record, ...albums];
    stage(next, `${exists ? '更新' : '新增'}相册：${record.title}`);
    setSelectedId(record.id);
    setEditingAlbum(null);
  };

  const savePhoto = () => {
    if (!selected || !editingPhoto) return;
    const url = editingPhoto.value.url.trim();
    if (!url) { setFormError('照片地址不能为空。'); return; }
    const photos = [...selected.photos];
    if (editingPhoto.index === null) photos.unshift({ ...editingPhoto.value, url });
    else photos[editingPhoto.index] = { ...editingPhoto.value, url };
    const next = albums.map((album) => album.id === selected.id ? { ...album, photos } : album);
    stage(next, `${editingPhoto.index === null ? '新增' : '更新'}照片：${selected.title}`);
    setEditingPhoto(null);
  };

  const remove = () => {
    if (!deleting) return;
    if (deleting.type === 'album' && deleting.id) {
      const next = albums.filter((album) => album.id !== deleting.id);
      stage(next, `移除相册：${deleting.title}`);
      if (selectedId === deleting.id) setSelectedId(next[0]?.id || '');
    } else if (deleting.type === 'photo' && selected && deleting.index !== undefined) {
      const next = albums.map((album) => album.id === selected.id ? { ...album, photos: album.photos.filter((_, index) => index !== deleting.index) } : album);
      stage(next, `移除照片：${selected.title}`);
    }
    setDeleting(null);
  };

  return <>
    <PageHeader eyebrow="Gallery structured data" title="相册" description="统一编辑相册封面、照片与说明；图片选择复用本地图床媒体库。" actions={<button className="console-action" type="button" onClick={() => { setFormError(''); setEditingAlbum(emptyAlbum()); }}><Plus size={16} />新增相册</button>} />
    <section className="console-grid"><article className="metric-card span-3"><span>相册</span><strong>{albums.length}</strong><small>公开集合</small></article><article className="metric-card span-3"><span>照片</span><strong>{photoCount}</strong><small>远程资源</small></article><article className="console-panel span-6"><header><div><h2>筛选相册</h2><span>选择一个相册后在下方维护照片</span></div></header><label className="media-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、简介或日期" /></label></article></section>

    <section className="console-panel gallery-section">
      <header><div><h2>相册列表</h2><span>{filtered.length} 个结果</span></div></header>
      {filtered.length ? <div className="album-strip">{filtered.map((album) => <article className={album.id === selectedId ? 'is-selected' : ''} key={album.id} onClick={() => setSelectedId(album.id)}>
        <img src={album.cover} alt="" /><div><strong>{album.title}</strong><span>{album.photos.length} 张照片 · {album.date || '未设置日期'}</span></div><div className="album-actions"><button type="button" onClick={(event) => { event.stopPropagation(); setFormError(''); setEditingAlbum({ ...album, photos: [...album.photos] }); }} aria-label={`编辑${album.title}`}><Pencil size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); setDeleting({ type: 'album', id: album.id, title: album.title }); }} aria-label={`删除${album.title}`}><Trash2 size={14} /></button></div>
      </article>)}</div> : <div className="structured-empty"><Images size={28} /><strong>{query ? '没有匹配的相册' : '还没有相册'}</strong></div>}
    </section>

    <section className="console-panel gallery-section">
      <header><div><h2>{selected ? selected.title : '照片列表'}</h2><span>{selected ? `${selected.photos.length} 张照片` : '请先选择或新增相册'}</span></div>{selected && <button className="console-action" type="button" onClick={() => { setFormError(''); setEditingPhoto({ index: null, value: emptyPhoto() }); }}><Plus size={16} />添加照片</button>}</header>
      {selected ? selected.photos.length ? <div className="photo-record-grid">{selected.photos.map((photo, index) => <article key={`${photo.url}-${index}`}><img src={photo.url} alt={photo.caption || ''} loading="lazy" /><div><strong>{photo.caption || '未填写说明'}</strong><span>{photo.url}</span></div><footer><button type="button" onClick={() => { setFormError(''); setEditingPhoto({ index, value: { ...photo } }); }} aria-label="编辑照片"><Pencil size={14} /></button><button type="button" onClick={() => setDeleting({ type: 'photo', index, title: photo.caption || `第 ${index + 1} 张照片` })} aria-label="删除照片"><Trash2 size={14} /></button></footer></article>)}</div> : <div className="structured-empty"><ImageIcon size={28} /><strong>这个相册还没有照片</strong><span>通过媒体库选择或上传第一张图片。</span></div> : <div className="structured-empty"><Images size={28} /><strong>请选择一个相册</strong></div>}
    </section>

    <ConsoleDialog open={Boolean(editingAlbum)} eyebrow="ALBUM RECORD" title={editingAlbum?.id ? '编辑相册' : '新增相册'} onClose={() => setEditingAlbum(null)} wide footer={<><button className="console-action secondary" type="button" onClick={() => setEditingAlbum(null)}>取消</button><button className="console-action" type="button" onClick={saveAlbum}>加入队列</button></>}>
      {editingAlbum && <div className="console-form"><div className="form-grid"><label className="form-field"><span>相册标题</span><input value={editingAlbum.title} maxLength={120} onChange={(event) => setEditingAlbum({ ...editingAlbum, title: event.target.value })} /></label><label className="form-field"><span>日期</span><input type="date" value={editingAlbum.date} onChange={(event) => setEditingAlbum({ ...editingAlbum, date: event.target.value })} /></label><div className="form-field full"><span>封面</span><div className="media-field-control"><div className="media-field-preview">{editingAlbum.cover ? <img src={editingAlbum.cover} alt="" /> : <ImageIcon size={20} />}</div><input value={editingAlbum.cover} onChange={(event) => setEditingAlbum({ ...editingAlbum, cover: event.target.value })} /><button className="console-action secondary" type="button" onClick={() => setMediaTarget('album')}>媒体库</button></div></div><label className="form-field full"><span>相册简介</span><textarea value={editingAlbum.description} maxLength={500} onChange={(event) => setEditingAlbum({ ...editingAlbum, description: event.target.value })} /></label></div>{formError && <div className="form-status error" role="alert">{formError}</div>}</div>}
    </ConsoleDialog>

    <ConsoleDialog open={Boolean(editingPhoto)} eyebrow="PHOTO RECORD" title={editingPhoto?.index === null ? '添加照片' : '编辑照片'} onClose={() => setEditingPhoto(null)} footer={<><button className="console-action secondary" type="button" onClick={() => setEditingPhoto(null)}>取消</button><button className="console-action" type="button" onClick={savePhoto}>加入队列</button></>}>
      {editingPhoto && <div className="console-form"><div className="form-field"><span>图片地址</span><div className="media-field-control"><div className="media-field-preview">{editingPhoto.value.url ? <img src={editingPhoto.value.url} alt="" /> : <ImageIcon size={20} />}</div><input value={editingPhoto.value.url} onChange={(event) => setEditingPhoto({ ...editingPhoto, value: { ...editingPhoto.value, url: event.target.value } })} /><button className="console-action secondary" type="button" onClick={() => setMediaTarget('photo')}>媒体库</button></div></div><label className="form-field"><span>照片说明</span><textarea value={editingPhoto.value.caption || ''} maxLength={500} onChange={(event) => setEditingPhoto({ ...editingPhoto, value: { ...editingPhoto.value, caption: event.target.value } })} /></label>{formError && <div className="form-status error" role="alert">{formError}</div>}</div>}
    </ConsoleDialog>

    <MediaPicker open={Boolean(mediaTarget)} onClose={() => setMediaTarget(null)} onSelect={(url) => { if (mediaTarget === 'album') setEditingAlbum((current) => current ? { ...current, cover: url } : current); if (mediaTarget === 'photo') setEditingPhoto((current) => current ? { ...current, value: { ...current.value, url } } : current); }} currentUrl={mediaTarget === 'album' ? editingAlbum?.cover : editingPhoto?.value.url} />
    <ConfirmDialog open={Boolean(deleting)} title={deleting?.type === 'album' ? '移除相册' : '移除照片'} description={`“${deleting?.title || ''}”将从公开相册数据中移除。操作应用前仍可在队列中清空。`} onClose={() => setDeleting(null)} onConfirm={remove} />
  </>;
}
