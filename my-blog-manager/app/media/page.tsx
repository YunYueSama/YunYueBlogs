import { ArrowUpRight, Images, Link2, Music2, PanelsTopLeft, Plug } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '../../components/manager/PageHeader';
import MediaCenter from '../../components/manager/MediaCenter';
import { readWorkspaceJson } from '../../lib/workspaceData';

export const dynamic = 'force-dynamic';

export default function MediaPage() {
  const albums = readWorkspaceJson<Array<{ photos?: unknown[] }>>('albums', []);
  const friends = readWorkspaceJson<unknown[]>('friends', []);
  const projects = readWorkspaceJson<unknown[]>('projects', []);
  const photos = albums.reduce((sum, album) => sum + (album.photos?.length || 0), 0);
  return <><PageHeader eyebrow="Media and structured data" title="媒体与图床" description="统一管理上传资源、相册、项目和友链；图床密钥只保存在本机。" />
    <section className="console-grid"><article className="metric-card span-4"><span>相册 / 图片</span><strong>{albums.length} / {photos}</strong><small>远程图床资源</small></article><article className="metric-card span-4"><span>项目</span><strong>{projects.length}</strong><small>公开作品档案</small></article><article className="metric-card span-4"><span>友链</span><strong>{friends.length}</strong><small>独立站点邻居</small></article>
    <MediaCenter />
    <article className="console-panel span-12"><header><h2>资料编辑入口</h2></header><div className="quick-actions"><Link href="/photowall"><Images size={20} /><strong>相册与图床</strong><span>管理相册、封面与图片说明</span><ArrowUpRight size={15} /></Link><Link href="/music"><Music2 size={20} /><strong>音乐资源</strong><span>查询、排序和校验网易云播放列表</span><ArrowUpRight size={15} /></Link><Link href="/projects"><PanelsTopLeft size={20} /><strong>项目档案</strong><span>项目介绍、技术栈与仓库地址</span><ArrowUpRight size={15} /></Link><Link href="/friends"><Link2 size={20} /><strong>友链</strong><span>站点信息、头像与主题色</span><ArrowUpRight size={15} /></Link><Link href="/integrations"><Plug size={20} /><strong>图床连接配置</strong><span>服务地址、名称、Token 与连接测试</span><ArrowUpRight size={15} /></Link></div></article></section></>;
}
