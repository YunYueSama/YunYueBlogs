export type ProjectRecord = { id: string; name: string; description: string; icon: string; githubUrl: string; tags: string[] };
export type FriendRecord = { id: string; name: string; url: string; description: string; avatar: string; themeColor: string };
export type PhotoRecord = { url: string; caption?: string };
export type AlbumRecord = { id: string; title: string; description: string; cover: string; date: string; photos: PhotoRecord[] };
export type ContentRecord = { id: string | null; type: 'post' | 'chatter' | 'about'; title: string; tags: string[]; cover: string; mood: string; description: string; content: string; date: string; published: boolean };
export type MomentRecord = { id: string; date: string; content: string; location: string; images: string[] };

export type OperationPayloadMap = {
  content_upsert: ContentRecord;
  content_delete: { id: string; type: 'post' | 'chatter' | 'about' };
  moment_upsert: MomentRecord;
  moment_delete: { id: string };
  projects_update: { projects: ProjectRecord[] };
  gallery_update: { albums: AlbumRecord[] };
  friends_update: { friends: FriendRecord[] };
  settings_update: { values: Record<string, string | number | boolean | string[] | null> };
};

export type OperationType = keyof OperationPayloadMap;
type OperationBase = { id: string; label: string; description: string; timestamp: string };

export type Operation = {
  [K in OperationType]: OperationBase & { type: K; payload: OperationPayloadMap[K] }
}[OperationType];

export type OperationInput = {
  [K in OperationType]: Partial<OperationBase> & Pick<OperationBase, 'label'> & { type: K; payload: OperationPayloadMap[K] }
}[OperationType];
