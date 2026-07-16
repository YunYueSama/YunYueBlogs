import PageHeader from '../../components/manager/PageHeader';
import MediaCenter from '../../components/manager/MediaCenter';

export const dynamic = 'force-dynamic';

export default function MediaPage() {
  return <><PageHeader eyebrow="Image hosting and media" title="图床与媒体库" description="上传、登记和复用头像、封面、正文图片与相册资源；连接密钥仍只保存在本机。" />
    <section className="console-grid"><MediaCenter /></section></>;
}
