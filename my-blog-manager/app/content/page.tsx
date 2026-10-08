import { FilePlus2, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '../../components/manager/PageHeader';
import { listDocuments } from '../../lib/workspaceData';
import ContentLibrary from '../../components/manager/ContentLibrary';

export const dynamic = 'force-dynamic';

export default function ContentPage() {
  const documents = [...listDocuments('posts'), ...listDocuments('chatters')].sort((a, b) => b.date.localeCompare(a.date));
  return <>
    <PageHeader eyebrow="Content workspace" title="内容" description="统一浏览文章与杂谈；草稿、已发布内容和本地文件使用同一套元数据。" actions={<><Link className="console-action secondary" href="/moments"><MessageCircle size={16} />说说</Link><Link className="console-action secondary" href="/drafts">草稿箱</Link><Link className="console-action" href="/editor"><FilePlus2 size={16} />新建内容</Link></>} />
    <ContentLibrary documents={documents} />
  </>;
}
