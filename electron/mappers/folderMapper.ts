import { Folder } from '../../src/types';

export interface FolderRow {
  id: string;
  topic_id: string;
  profile_id: string;
  name: string;
  created_at: number;
}

export function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    topicId: row.topic_id,
    profileId: row.profile_id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function toFolderRow(folder: Folder): FolderRow {
  return {
    id: folder.id,
    topic_id: folder.topicId,
    profile_id: folder.profileId,
    name: folder.name,
    created_at: new Date(folder.createdAt).getTime()
  };
}
