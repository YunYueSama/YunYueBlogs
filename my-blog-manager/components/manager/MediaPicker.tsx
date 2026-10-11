'use client';
/* eslint-disable @next/next/no-img-element -- Media hosts are configured at runtime and cannot use a fixed Next image allowlist. */

import { Check, CloudUpload, Image as ImageIcon, Link2, LoaderCircle, Search, X } from 'lucide-react';
import { useModalDialog } from '../../lib/useModalDialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MEDIA_PAGE_SIZE, loadMedia, publicMediaPreview, registerExternalImage, uploadImage, type ImageAsset } from '../../lib/media';

type PickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, asset?: ImageAsset) => void;
  currentUrl?: string;
};

export default function MediaPicker({ open, onClose, onSelect, currentUrl = '' }: PickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useModalDialog(open);
  const request = useRef<AbortController | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [appliedQuery, setAppliedQuery] = useState('');
  const [items, setItems] = useState<ImageAsset[]>([]);
  const [query, setQuery] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; message: string } | null>(null);

  const refresh = useCallback(async (nextQuery: string, nextOffset = 0) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setStatus(null);
    try {
      const page = await loadMedia(nextQuery, nextOffset, controller.signal);
      if (!controller.signal.aborted) { setItems(page.items); setTotal(page.total); setOffset(nextOffset); setAppliedQuery(nextQuery); }
    } catch (error) { if (!controller.signal.aborted) setStatus({ error: true, message: error instanceof Error ? error.message : '媒体库加载失败' }); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    if (open) { setQuery(''); void refresh(''); }
    return () => request.current?.abort();
  }, [open, refresh]);

  const handleUpload = async (file?: File) => {
    if (!file || uploading) return;
    setUploading(true);
    setStatus(null);
    try {
      const asset = await uploadImage(file, file.name.replace(/\.[^.]+$/, ''));
      setItems((current) => [asset, ...current.filter((item) => item.url !== asset.url)]);
      onSelect(asset.url, asset);
      onClose();
    } catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '上传失败' }); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const handleExternal = async () => {
    if (!externalUrl.trim()) return;
    setUploading(true);
    setStatus(null);
    try {
      const asset = await registerExternalImage(externalUrl.trim());
      onSelect(asset.url, asset);
      onClose();
    } catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '外链登记失败' }); }
    finally { setUploading(false); }
  };

  if (!open) return null;
  return <dialog ref={dialog} className="console-native-dialog media-native-dialog" aria-labelledby="media-picker-title" onCancel={(event) => { event.preventDefault(); if (!uploading) onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget && !uploading) onClose(); }}>
    <section className="media-dialog">
      <header><div><span>MEDIA LIBRARY</span><h2 id="media-picker-title">选择媒体资源</h2></div><button className="console-icon" type="button" onClick={onClose} disabled={uploading} aria-label="关闭媒体库"><X size={18} /></button></header>
      <div className="media-picker-tools">
        <label className="media-search"><Search size={16} /><input autoFocus aria-label="搜索媒体资源" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refresh(query); }} placeholder="搜索说明或 URL" /></label>
        <button className="console-action secondary" type="button" onClick={() => void refresh(query)} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}搜索</button>
        <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={(event) => void handleUpload(event.target.files?.[0])} />
        <button className="console-action" type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="animate-spin" size={16} /> : <CloudUpload size={16} />}上传图片</button>
      </div>
      <div className="media-external"><Link2 size={16} /><input type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="登记已有 HTTPS 图片地址" /><button type="button" onClick={() => void handleExternal()} disabled={!externalUrl.trim() || uploading}>使用外链</button></div>
      {status && <div className={`form-status ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.message}</div>}
      <div className="media-picker-grid">
        {loading && !items.length ? <div className="media-empty"><LoaderCircle className="animate-spin" /><span>正在读取媒体库</span></div> : items.length ? items.map((asset) => <button disabled={uploading || loading} className={asset.url === currentUrl ? 'is-selected' : ''} type="button" key={asset.id} onClick={() => { onSelect(asset.url, asset); onClose(); }}><img src={asset.thumbnailUrl || asset.url} alt={asset.alt || '媒体资源预览'} loading="lazy" decoding="async" /><span><strong>{asset.alt || '未命名图片'}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.source}</small></span>{asset.url === currentUrl && <i><Check size={14} /></i>}</button>) : <div className="media-empty"><ImageIcon /><strong>{appliedQuery ? '没有匹配的图片' : '媒体库还是空的'}</strong><span>{appliedQuery ? '试试其他关键词。' : '上传图片或登记已有外链后，它会出现在这里。'}</span></div>}
      </div>
      <footer className="content-pagination media-pagination"><span role="status">共 {total} 项 · 第 {Math.floor(offset / MEDIA_PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / MEDIA_PAGE_SIZE))} 页</span><button type="button" className="console-action secondary" disabled={loading || offset === 0} onClick={() => void refresh(appliedQuery, Math.max(0, offset - MEDIA_PAGE_SIZE))}>上一页</button><button type="button" className="console-action secondary" disabled={loading || offset + items.length >= total} onClick={() => void refresh(appliedQuery, offset + MEDIA_PAGE_SIZE)}>下一页</button></footer>
    </section>
  </dialog>;
}

export function MediaField({ label, value, onChange, description, siteUrl = '' }: { label: string; value: string; onChange: (value: string) => void; description?: string; siteUrl?: string }) {
  const [open, setOpen] = useState(false);
  const preview = publicMediaPreview(value, siteUrl);
  return <div className="form-field media-field">
    <label>{label}</label>
    <div className="media-field-control">
      <div className="media-field-preview">{preview ? <img src={preview} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={20} />}</div>
      <input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="本地路径或 HTTPS 图片地址" />
      <button className="console-action secondary" type="button" onClick={() => setOpen(true)}><ImageIcon size={16} />媒体库</button>
    </div>
    {description && <small>{description}</small>}
    <MediaPicker open={open} onClose={() => setOpen(false)} onSelect={onChange} currentUrl={value} />
  </div>;
}
