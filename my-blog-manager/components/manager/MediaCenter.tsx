'use client';
/* eslint-disable @next/next/no-img-element -- Media hosts are configured at runtime and cannot use a fixed Next image allowlist. */

import { CheckCircle2, Clipboard, CloudUpload, Image as ImageIcon, Link2, LoaderCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import { DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { managerApi } from '../../lib/managerApi';
import { MEDIA_PAGE_SIZE, loadMedia, registerExternalImage, uploadImage, type ImageAsset } from '../../lib/media';

type Integrations = { picBedUrl: string; picBedName: string; picBedTokenConfigured: boolean };

export default function MediaCenter() {
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [appliedQuery, setAppliedQuery] = useState('');
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [integration, setIntegration] = useState<Integrations | null>(null);
  const [query, setQuery] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<'load' | 'upload' | 'test' | 'external' | 'remove' | null>('load');
  const [status, setStatus] = useState<{ error?: boolean; message: string } | null>(null);

  const refresh = useCallback(async (nextQuery: string, nextOffset = 0) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    if (!mutation.current) setBusy('load');
    setStatus(null);
    try {
      const media = await loadMedia(nextQuery, nextOffset, controller.signal);
      if (!controller.signal.aborted) { setAssets(media.items); setTotal(media.total); setOffset(nextOffset); setAppliedQuery(nextQuery); }
      return !controller.signal.aborted;
    } catch (error) { if (!controller.signal.aborted) setStatus({ error: true, message: error instanceof Error ? error.message : '媒体数据加载失败' }); return false; }
    finally { if (!controller.signal.aborted && !mutation.current) setBusy(null); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    managerApi<Integrations>('/api/settings/integrations', { signal: controller.signal }).then(setIntegration).catch(() => undefined);
    void refresh('');
    return () => { controller.abort(); request.current?.abort(); };
  }, [refresh]);

  const handleFile = async (file?: File) => {
    if (!file || busy || mutation.current) return;
    mutation.current = true;
    setBusy('upload'); setStatus(null);
    try {
      await uploadImage(file, file.name.replace(/\.[^.]+$/, ''));
      const refreshed = await refresh(appliedQuery);
      setStatus({ error: !refreshed, message: refreshed ? '图片已上传并加入媒体库。' : '图片已上传，但列表刷新失败，请刷新后查看，无需重复上传。' });
    }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '上传失败' }); }
    finally { mutation.current = false; setBusy(null); if (fileInput.current) fileInput.current.value = ''; }
  };
  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void handleFile(event.dataTransfer.files?.[0]); };
  const testConnection = async () => {
    if (busy || mutation.current) return;
    mutation.current = true;
    setBusy('test'); setStatus(null);
    try { const result = await managerApi<{ name: string; message: string }>('/api/picbed/test', { method: 'POST', body: '{}' }); setStatus({ message: `${result.name}：${result.message}` }); }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '连接测试失败' }); }
    finally { mutation.current = false; setBusy(null); }
  };
  const addExternal = async () => {
    if (!externalUrl.trim() || busy || mutation.current) return;
    mutation.current = true;
    setBusy('external'); setStatus(null);
    try {
      await registerExternalImage(externalUrl.trim());
      const refreshed = await refresh(appliedQuery);
      setExternalUrl('');
      setStatus({ error: !refreshed, message: refreshed ? '外链已登记到媒体库。' : '外链已登记，但列表刷新失败，请刷新后查看，无需重复登记。' });
    }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '外链登记失败' }); }
    finally { mutation.current = false; setBusy(null); }
  };
  const remove = async (asset: ImageAsset) => {
    if (busy || mutation.current) return;
    if (!confirm('只从本地媒体清单移除，不会删除图床远程文件。继续吗？')) return;
    mutation.current = true;
    setBusy('remove'); setStatus(null);
    try { await managerApi(`/api/picbed/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' }); await refresh(appliedQuery, assets.length === 1 ? Math.max(0, offset - MEDIA_PAGE_SIZE) : offset); }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '移除失败' }); }
    finally { mutation.current = false; setBusy(null); }
  };
  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setStatus({ message: '图片链接已复制。' }); }
    catch { setStatus({ error: true, message: '无法访问剪贴板，请检查浏览器权限后重试。' }); }
  };

  return <>
    <section className="console-panel span-5"><header><div><h2>图床状态</h2><span>Token 只保存在本机，不会回显或同步</span></div>{integration?.picBedTokenConfigured && <CheckCircle2 size={18} color="var(--console-cyan)" />}</header>
      <div className="integration-summary"><strong>{integration?.picBedName || '尚未命名'}</strong><span>{integration?.picBedUrl || '请先前往集成页面配置图床'}</span></div>
      <div className="console-page-actions"><Link className="console-action secondary" href="/integrations">配置图床</Link><button className="console-action secondary" type="button" onClick={() => void testConnection()} disabled={Boolean(busy) || !integration?.picBedTokenConfigured}>{busy === 'test' ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}测试连接</button></div>
    </section>
    <section className="console-panel span-7"><header><div><h2>上传图片</h2><span>PNG、JPEG、GIF、WebP、AVIF，最大 12MB</span></div></header>
      <div className={`media-dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => !busy && fileInput.current?.click()} role="button" aria-disabled={Boolean(busy)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busy) fileInput.current?.click(); } }}>
        <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={(event) => void handleFile(event.target.files?.[0])} />
        {busy === 'upload' ? <LoaderCircle className="animate-spin" size={26} /> : <CloudUpload size={26} />}<strong>{busy === 'upload' ? '正在上传并登记资源' : '拖放图片或点击选择文件'}</strong><span>上传前会读取尺寸，后端再次验证格式和大小。</span>
      </div>
    </section>
    <section className="console-panel span-12"><header><div><h2>媒体资源库</h2><span>{total} 个{appliedQuery ? '匹配' : '本地登记'}资源；移除不会删除远程文件</span></div></header>
      <div className="media-library-toolbar"><label className="media-search"><Search size={16} /><input aria-label="搜索媒体资源" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !busy && !mutation.current) void refresh(query); }} placeholder="搜索说明或 URL" /></label><button className="console-action secondary" type="button" onClick={() => void refresh(query)} disabled={Boolean(busy)}>{busy === 'load' ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}搜索</button><div className="media-register"><Link2 size={16} /><input aria-label="已有图片地址" type="url" disabled={Boolean(busy)} value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="登记已有 HTTPS 图片" /><button type="button" onClick={() => void addExternal()} disabled={!externalUrl.trim() || Boolean(busy)}>登记</button></div></div>
      {status && <div className={`form-status ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.message}</div>}
      <div className="media-library-grid" aria-busy={Boolean(busy)}>{busy === 'load' && !assets.length ? <div className="media-empty"><LoaderCircle className="animate-spin" /><span>正在读取媒体库</span></div> : assets.length ? assets.map((asset) => <article key={asset.id}><div className="media-asset-image"><img src={asset.thumbnailUrl || asset.url} alt={asset.alt || '媒体资源'} loading="lazy" decoding="async" /></div><div><strong>{asset.alt || '未命名图片'}</strong><span>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.source} · {asset.bytes ? `${Math.ceil(asset.bytes / 1024)}KB` : '远程资源'}</span></div><div className="media-asset-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void copyLink(asset.url)} title="复制链接" aria-label="复制图片链接"><Clipboard size={15} /></button><button type="button" disabled={Boolean(busy)} onClick={() => void remove(asset)} title="从清单移除" aria-label="从媒体清单移除"><Trash2 size={15} /></button></div></article>) : <div className="media-empty"><ImageIcon size={28} /><strong>{appliedQuery ? '没有匹配的图片' : '媒体库还是空的'}</strong><span>{appliedQuery ? '试试其他关键词。' : '上传图片或登记已有外链后，它会出现在这里。'}</span></div>}</div>
      <footer className="content-pagination"><span role="status">第 {Math.floor(offset / MEDIA_PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / MEDIA_PAGE_SIZE))} 页</span><button type="button" className="console-action secondary" disabled={Boolean(busy) || offset === 0} onClick={() => void refresh(appliedQuery, Math.max(0, offset - MEDIA_PAGE_SIZE))}>上一页</button><button type="button" className="console-action secondary" disabled={Boolean(busy) || offset + assets.length >= total} onClick={() => void refresh(appliedQuery, offset + MEDIA_PAGE_SIZE)}>下一页</button></footer>
    </section>
  </>;
}
