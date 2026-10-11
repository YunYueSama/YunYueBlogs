'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNavigationGuard } from '../../context/NavigationGuardContext';
import { Search, X, ArrowUpRight } from 'lucide-react';

const destinations = [
  { href: '/setup', label: '连接博客', description: '新设备首次连接与创建博客', keywords: '安装 向导 GitHub' },
  { href: '/editor', label: '新建文章', description: '记录新的想法', keywords: '写作 新建' },
  { href: '/drafts', label: '草稿箱', description: '继续未完成的写作', keywords: '草稿' },
  { href: '/content', label: '内容库', description: '搜索文章与杂谈', keywords: '文章 搜索' },
  { href: '/moments', label: '说说', description: '分享生活动态', keywords: '动态' },
  { href: '/media', label: '图床', description: '上传与复用图片', keywords: '图片 媒体 上传' },
  { href: '/music', label: '音乐', description: '维护播放列表', keywords: '歌曲 歌词' },
  { href: '/photowall', label: '相册', description: '整理照片与相册', keywords: '照片' },
  { href: '/projects', label: '项目', description: '维护项目展示', keywords: '作品' },
  { href: '/friends', label: '友链', description: '管理朋友的站点', keywords: '链接' },
  { href: '/appearance', label: '外观', description: '修改公开站样式', keywords: '主题 设置' },
  { href: '/integrations', label: '集成', description: '配置图床与第三方服务', keywords: '配置 token' },
  { href: '/publish', label: '发布', description: '预览差异并同步仓库', keywords: '同步 部署' },
];

export default function QuickNavigation() {
  const router = useRouter();
  const { navigate: guardedNavigate } = useNavigationGuard();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const matches = destinations.filter((item) => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dialog.current?.showModal();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const navigate = (href: string) => { dialog.current?.close(); guardedNavigate(() => router.push(href)); };
  return <>
    <button className="console-action secondary quick-nav-trigger" onClick={() => { setQuery(''); dialog.current?.showModal(); }} aria-label="打开快捷导航" title="快捷导航（Ctrl+K）"><Search size={16} /><span>快速前往</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} className="quick-nav-dialog" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="quick-nav-heading"><h2>快速前往</h2><button className="console-icon" aria-label="关闭快捷导航" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <label className="media-search"><Search size={18} /><input autoFocus aria-label="搜索功能" placeholder="搜索功能，按 Enter 打开第一项" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) navigate(matches[0].href); }} /></label>
      <div className="quick-nav-results">{matches.map((item) => <button key={item.href} onClick={() => navigate(item.href)}><div><strong>{item.label}</strong><span>{item.description}</span></div><ArrowUpRight size={18} /></button>)}{!matches.length && <p className="console-note">没有匹配的功能，请换个关键词。</p>}</div>
      <p className="console-note">Ctrl / ⌘ + K 打开 · Esc 关闭 · Tab 选择</p>
    </dialog>
  </>;
}
