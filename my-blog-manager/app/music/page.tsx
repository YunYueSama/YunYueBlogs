import MusicManager from '../../components/manager/MusicManager';
import PageHeader from '../../components/manager/PageHeader';

export default function MusicPage() {
  return <><PageHeader eyebrow="Audio resources" title="音乐资源" description="管理酷狗 + 网易云双源歌单，自动匹配 KRC 逐字歌词并通过发布流程同步。" /><MusicManager /></>;
}
