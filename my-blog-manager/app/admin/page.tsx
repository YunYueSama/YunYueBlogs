import { ArrowUpRight, FilePlus2, FolderGit2, ImagePlus, PlugZap } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '../../components/manager/PageHeader';
import { contentCounts, readDeployConfig } from '../../lib/workspaceData';

export const dynamic = 'force-dynamic';

export default function AdminDashboard() {
  const counts = contentCounts();
  const deploy = readDeployConfig();
  return <>
    <PageHeader eyebrow="Workspace overview" title="概览" description="从写作到 Vercel 发布的本地工作台。所有高风险操作都必须先生成差异预览。" actions={<Link className="console-action" href="/publish">查看发布状态 <ArrowUpRight size={16} /></Link>} />
    <section className="console-grid" aria-label="内容统计">
      <article className="metric-card span-3"><span>文章</span><strong>{counts.posts}</strong><small>Markdown 内容</small></article>
      <article className="metric-card span-3"><span>杂谈</span><strong>{counts.chatters}</strong><small>长短随想</small></article>
      <article className="metric-card span-3"><span>说说</span><strong>{counts.moments}</strong><small>生活动态</small></article>
      <article className="metric-card span-3"><span>发布目标</span><strong>{deploy.blogPath ? '已连接' : '未配置'}</strong><small>{deploy.branch || 'main'} 分支</small></article>

      <article className="console-panel span-8"><header><div><h2>发布链路</h2><span>本地工作区 → Astro 博客仓库 → GitHub → Vercel</span></div></header><div className="console-list"><div className="console-list-row"><div><strong><i className="status-dot" />内容工作区</strong><span>文章与结构化数据独立于管理端代码仓库</span></div><span>{counts.posts + counts.chatters + counts.moments} 个内容文件</span></div><div className="console-list-row"><div><strong><i className={`status-dot ${deploy.blogPath ? '' : 'warn'}`} />公开博客仓库</strong><span>{deploy.blogPath || '尚未设置本地仓库路径'}</span></div><Link className="console-action secondary" href="/publish">配置</Link></div><div className="console-list-row"><div><strong><i className="status-dot" />安全策略</strong><span>受管清单、原子同步、无关改动拦截、禁止强推</span></div><span>已启用</span></div></div></article>
      <article className="console-panel span-4"><header><h2>快捷操作</h2></header><div className="quick-actions"><Link href="/editor"><FilePlus2 size={20} /><strong>写文章</strong></Link><Link href="/moments"><ImagePlus size={20} /><strong>发说说</strong></Link><Link href="/integrations"><PlugZap size={20} /><strong>配置集成</strong></Link><Link href="/publish"><FolderGit2 size={20} /><strong>同步仓库</strong></Link></div></article>
    </section>
  </>;
}
