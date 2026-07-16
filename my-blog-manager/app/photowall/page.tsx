import GalleryManager from './GalleryManager';
import type { AlbumRecord } from '../../lib/operationTypes';
import { readWorkspaceJson } from '../../lib/workspaceData';

export const metadata = {
  title: '相册',
  description: '管理公开相册、封面与照片说明。',
};

export default function PhotoWallPage() {
  const albums = readWorkspaceJson<AlbumRecord[]>('albums', []);
  return <GalleryManager initialAlbums={albums} />;
}
