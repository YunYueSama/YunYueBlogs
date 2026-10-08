import MomentList from './MomentList';
import { listMoments } from '../../lib/workspaceData';

export const metadata = {
  title: '说说',
  description: '管理生活动态、地点与图片。',
};

export default async function MomentsPage() {
  const allMoments = await listMoments();

  return <MomentList moments={allMoments} />;
}
