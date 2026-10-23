'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNavigationGuard } from '../../context/NavigationGuardContext';
import { useModalDialog } from '../../lib/useModalDialog';
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
  const [open, setOpen] = useState(false);
  const dialog = useModalDialog(open);
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = destinations.filter((item) => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));
  const show = useCallback(() => {
    setQuery(''); setActiveIndex(0); setOpen(true);
    input.current?.focus();
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [show]);
  useEffect(() => {
    // 原生 dialog 进入顶层后再聚焦，避免 showModal 把焦点放到关闭按钮。
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${resultsId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, resultsId, selectedIndex]);
  const navigate = (href: string) => { dialog.current?.close(); setOpen(false); guardedNavigate(() => router.push(href)); };
  return <>
    <button className="console-action secondary quick-nav-trigger" onClick={show} aria-label="打开快捷导航" title="快捷导航（Ctrl+K）"><Search size={16} /><span>快速前往</span><kbd>Ctrl K</kbd></button>
    {open && <dialog ref={dialog} className="quick-nav-dialog" aria-labelledby={`${resultsId}-title`} onCancel={(event) => { event.preventDefault(); setOpen(false); }} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="quick-nav-heading"><h2 id={`${resultsId}-title`}>快速前往</h2><button className="console-icon" aria-label="关闭快捷导航" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <label className="media-search"><Search size={18} /><input ref={input} role="combobox" aria-expanded="true" aria-controls={resultsId} aria-activedescendant={matches.length ? `${resultsId}-${selectedIndex}` : undefined} aria-autocomplete="list" aria-label="搜索功能" placeholder="搜索功能，使用方向键选择" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
        // 中文输入法的回车用于选字，不能误触发页面跳转。
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
          event.preventDefault();
          setActiveIndex((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        } else if (event.key === 'Enter' && matches[selectedIndex]) {
          event.preventDefault(); navigate(matches[selectedIndex].href);
        }
      }} /></label>
      <div id={resultsId} className="quick-nav-results" role="listbox" aria-label="功能列表">{matches.map((item, index) => <button id={`${resultsId}-${index}`} role="option" aria-selected={selectedIndex === index} tabIndex={-1} key={item.href} onMouseEnter={() => setActiveIndex(index)} onClick={() => navigate(item.href)}><div><strong>{item.label}</strong><span>{item.description}</span></div><ArrowUpRight size={18} /></button>)}</div>
      {!matches.length && <p className="console-note" role="status">没有匹配的功能，请换个关键词。</p>}
      <p className="console-note">↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>
    </dialog>}
  </>;
}
