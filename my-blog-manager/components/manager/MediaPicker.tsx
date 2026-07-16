'use client';
/* eslint-disable @next/next/no-img-element -- Media hosts are configured at runtime and cannot use a fixed Next image allowlist. */

import { Check, CloudUpload, Image as ImageIcon, Link2, LoaderCircle, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMedia, registerExternalImage, uploadImage, type ImageAsset } from '../../lib/media';

type PickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, asset?: ImageAsset) => void;
  currentUrl?: string;
};

export default function MediaPicker({ open, onClose, onSelect, currentUrl = '' }: PickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImageAsset[]>([]);
  const [query, setQuery] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; message: string } | null>(null);

  const refresh = useCallback(async (nextQuery: string) => {
    setLoading(true);
    setStatus(null);
    try { setItems((await loadMedia(nextQuery)).items); }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '媒体库加载失败' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) void refresh(''); }, [open, refresh]);

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

  return <AnimatePresence>{open && <motion.div className="media-modal-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section className="media-dialog" role="dialog" aria-modal="true" aria-labelledby="media-picker-title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
      <header><div><span>MEDIA LIBRARY</span><h2 id="media-picker-title">选择媒体资源</h2></div><button className="console-icon" type="button" onClick={onClose} aria-label="关闭媒体库"><X size={18} /></button></header>
      <div className="media-picker-tools">
        <label className="media-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refresh(query); }} placeholder="搜索说明或 URL" /></label>
        <button className="console-action secondary" type="button" onClick={() => void refresh(query)} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}搜索</button>
        <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={(event) => void handleUpload(event.target.files?.[0])} />
        <button className="console-action" type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="animate-spin" size={16} /> : <CloudUpload size={16} />}上传图片</button>
      </div>
      <div className="media-external"><Link2 size={16} /><input type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="登记已有 HTTPS 图片地址" /><button type="button" onClick={() => void handleExternal()} disabled={!externalUrl.trim() || uploading}>使用外链</button></div>
      {status && <div className={`form-status ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.message}</div>}
      <div className="media-picker-grid">
        {loading && !items.length ? <div className="media-empty"><LoaderCircle className="animate-spin" /><span>正在读取媒体库</span></div> : items.length ? items.map((asset) => <button className={asset.url === currentUrl ? 'is-selected' : ''} type="button" key={asset.id} onClick={() => { onSelect(asset.url, asset); onClose(); }}><img src={asset.thumbnailUrl || asset.url} alt={asset.alt || '媒体资源预览'} /><span><strong>{asset.alt || '未命名图片'}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.source}</small></span>{asset.url === currentUrl && <i><Check size={14} /></i>}</button>) : <div className="media-empty"><ImageIcon /><strong>媒体库还是空的</strong><span>上传图片或登记已有外链后，它会出现在这里。</span></div>}
      </div>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}

export function MediaField({ label, value, onChange, description }: { label: string; value: string; onChange: (value: string) => void; description?: string }) {
  const [open, setOpen] = useState(false);
  return <div className="form-field media-field">
    <label>{label}</label>
    <div className="media-field-control">
      <div className="media-field-preview">{value ? <img src={value} alt="" /> : <ImageIcon size={20} />}</div>
      <input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="本地路径或 HTTPS 图片地址" />
      <button className="console-action secondary" type="button" onClick={() => setOpen(true)}><ImageIcon size={16} />媒体库</button>
    </div>
    {description && <small>{description}</small>}
    <MediaPicker open={open} onClose={() => setOpen(false)} onSelect={onChange} currentUrl={value} />
  </div>;
}
