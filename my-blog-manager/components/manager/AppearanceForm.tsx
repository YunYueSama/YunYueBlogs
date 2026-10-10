'use client';

import { LoaderCircle, Save } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { managerApi } from '../../lib/managerApi';
import { MediaField } from './MediaPicker';

type SiteConfig = {
  title: string; shortTitle: string; author: string; bio: string; description: string; avatar: string; favicon: string; homeHero: string; defaultCover: string; siteUrl: string; buildDate: string;
  social: { github: string; email: string }; musicIds: string[]; musicTracks: Array<{ key: string; source: 'netease' | 'kugou'; id: string }>; danmaku: string[]; bangumiUsername: string;
  icp: { name: string; url: string };
};

export default function AppearanceForm() {
  const [data, setData] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; message: string } | null>(null);

  useEffect(() => { managerApi<SiteConfig>('/api/settings/public').then(setData).catch((error) => setStatus({ error: true, message: error.message })).finally(() => setLoading(false)); }, []);
  const update = (key: keyof SiteConfig, value: unknown) => setData((current) => current ? { ...current, [key]: value } : current);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!data || saving) return; setSaving(true); setStatus(null);
    try { const saved = await managerApi<SiteConfig>('/api/settings/public', { method: 'POST', body: JSON.stringify(data) }); setData(saved); setStatus({ message: '公开站配置已保存，将在下一次同步时进入差异清单。' }); }
    catch (error) { setStatus({ error: true, message: error instanceof Error ? error.message : '保存失败' }); }
    finally { setSaving(false); }
  };
  if (loading) return <div className="console-skeleton" />;
  if (!data) return <div className="form-status error">{status?.message || '无法加载配置。'}</div>;

  return <form className="console-form" onSubmit={submit}>
    <section className="console-panel"><header><div><h2>站点身份</h2><span>标题、作者与首页说明</span></div></header><div className="form-grid">
      <div className="form-field"><label htmlFor="title">完整站名</label><input id="title" required maxLength={100} value={data.title} onChange={(event) => update('title', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="shortTitle">短标题</label><input id="shortTitle" required maxLength={50} value={data.shortTitle} onChange={(event) => update('shortTitle', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="author">作者名</label><input id="author" required maxLength={50} value={data.author} onChange={(event) => update('author', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="siteUrl">正式域名</label><input id="siteUrl" type="url" value={data.siteUrl} onChange={(event) => update('siteUrl', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="buildDate">建站日期</label><input id="buildDate" type="date" required value={data.buildDate.slice(0, 10)} onChange={(event) => update('buildDate', `${event.target.value}T00:00:00+08:00`)} /><small>按北京时间零点计算网站运行时长。</small></div>
      <div className="form-field full"><label htmlFor="description">站点描述</label><textarea id="description" maxLength={300} value={data.description} onChange={(event) => update('description', event.target.value)} /></div>
      <div className="form-field full"><label htmlFor="bio">个人简介</label><textarea id="bio" maxLength={500} value={data.bio} onChange={(event) => update('bio', event.target.value)} /></div>
    </div></section>
    <section className="console-panel"><header><div><h2>媒体与氛围</h2><span>公开 URL 和轻量弹幕；图床密钥不在这里保存</span></div></header><div className="form-grid">
      <MediaField label="作者头像" value={data.avatar} onChange={(value) => update('avatar', value)} description="用于关于页、友链名片和默认作者身份。" />
      <MediaField label="网页图标" value={data.favicon} onChange={(value) => update('favicon', value)} description="建议使用正方形 PNG、WebP 或 ICO。" />
      <MediaField label="首页主视觉" value={data.homeHero} onChange={(value) => update('homeHero', value)} description="首屏 LCP 资源优先使用公开仓库中的本地路径。" />
      <MediaField label="默认文章封面" value={data.defaultCover} onChange={(value) => update('defaultCover', value)} description="文章未设置独立封面时使用。" />
      <div className="form-field full"><span>音乐播放列表</span><div className="integration-summary"><strong>{data.musicTracks?.length || data.musicIds.length} 首歌曲已配置</strong><span>酷狗 + 网易云双源查询、逐字歌词和排序已迁移到独立音乐资源页。</span></div><div><Link className="console-action secondary" href="/music">管理音乐资源</Link></div></div>
      <div className="form-field full"><label htmlFor="danmaku">首页弹幕</label><textarea id="danmaku" value={data.danmaku.join('\n')} onChange={(event) => update('danmaku', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /><small>每行一条；移动端和减少动画模式不会显示。</small></div>
    </div></section>
    {status && <div className={`form-status ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.message}</div>}
    <div><button className="console-action" type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存外观配置</button></div>
  </form>;
}
