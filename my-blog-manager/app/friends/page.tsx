import FriendsBoard from './FriendsBoard';
import { readWorkspaceJson } from '../../lib/workspaceData';
import type { FriendRecord } from '../../lib/operationTypes';

export const metadata = {
  title: '友链',
  description: '管理公开友链、头像与站点简介。',
};

export default function FriendsPage() {
  const friends = readWorkspaceJson<FriendRecord[]>('friends', []);
  return <FriendsBoard initialFriends={friends} />;
}
