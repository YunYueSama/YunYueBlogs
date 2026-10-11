'use client';

import { AppWindow, Boxes, ChevronRight, CloudUpload, FileText, Gauge, Image, Images, Link2, Menu, Music2, Palette, PanelsTopLeft, Plug, X } from 'lucide-react';
import Link from './GuardedLink';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import OperationQueue from './OperationQueue';
import QuickNavigation from './QuickNavigation';

const navigation = [
  { href: '/admin', label: '概览', icon: Gauge, aliases: ['/admin'] },
  { href: '/content', label: '内容', icon: FileText, aliases: ['/content', '/editor', '/drafts', '/moments'] },
  { href: '/media', label: '图床', icon: Image, aliases: ['/media'] },
  { href: '/music', label: '音乐', icon: Music2, aliases: ['/music'] },
  { href: '/photowall', label: '相册', icon: Images, aliases: ['/photowall'] },
  { href: '/projects', label: '项目', icon: PanelsTopLeft, aliases: ['/projects'] },
  { href: '/friends', label: '友链', icon: Link2, aliases: ['/friends'] },
  { href: '/appearance', label: '外观', icon: Palette, aliases: ['/appearance'] },
  { href: '/integrations', label: '集成', icon: Plug, aliases: ['/integrations'] },
  { href: '/publish', label: '发布', icon: CloudUpload, aliases: ['/publish'] },
];

export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (item: typeof navigation[number]) => item.aliases.some((alias) => pathname.startsWith(alias));
  const active = navigation.find(isActive) ?? navigation[0];

  return (
    <div className="console-shell">
      <aside className={`console-sidebar ${open ? 'is-open' : ''}`}>
        <div className="console-brand"><span><AppWindow size={19} /></span><div><strong>星辉云端</strong><small>YUNYUE CMS 2.0</small></div><button className="console-icon mobile-only" type="button" onClick={() => setOpen(false)} aria-label="关闭导航"><X size={19} /></button></div>
        <nav aria-label="控制台导航">{navigation.map((item) => { const Icon = item.icon; const selected = isActive(item); return <Link href={item.href} key={item.href} aria-current={selected ? 'page' : undefined} onClick={() => setOpen(false)}><Icon size={18} /><span>{item.label}</span>{selected && <ChevronRight size={15} />}</Link>; })}</nav>
        <div className="console-sidebar-meta"><Boxes size={17} /><div><strong>本地优先</strong><span>内容与密钥不会提交到管理端仓库</span></div></div>
      </aside>

      <div className="console-main">
        <header className="console-topbar"><button className="console-icon mobile-only" type="button" onClick={() => setOpen(true)} aria-label="打开导航"><Menu size={20} /></button><div><span>控制台 /</span><strong>{active.label}</strong></div><QuickNavigation /><OperationQueue /><Link className="console-action secondary" href="/editor"><FileText size={16} />新建内容</Link><Link className="console-action console-publish-action" href="/publish"><CloudUpload size={16} />发布</Link></header>
        <main className="console-content">{children}</main>
      </div>
      {open && <button className="console-scrim mobile-only" type="button" aria-label="关闭导航" onClick={() => setOpen(false)} />}
    </div>
  );
}
