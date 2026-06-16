import { Material } from '../../src/types';

export interface MaterialRow {
  id: string;
  folder_id: string;
  profile_id: string;
  box_type: string;
  title: string | null;
  url: string | null;
  local_path: string | null;
  storage_status: string;
  file_hash: string | null;
  file_size: number | null;
  trashed_at: number | null;
  trash_path?: string | null;
  created_at: number;
}

export function toMaterial(row: MaterialRow): Material {
  return {
    id: row.id,
    folderId: row.folder_id,
    topicId: '', // Requires JOIN to populate
    profileId: row.profile_id,
    boxType: row.box_type as any,
    title: row.title || '',
    url: row.url || '',
    localPath: row.local_path || undefined,
    storageStatus: row.storage_status as any,
    fileHash: row.file_hash || undefined,
    fileSizeBytes: row.file_size || undefined,
    trashedAt: row.trashed_at ? new Date(row.trashed_at).toISOString() : undefined,
    trashPath: row.trash_path || undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function toMaterialRow(material: Material): MaterialRow {
  return {
    id: material.id,
    folder_id: material.folderId,
    profile_id: material.profileId,
    box_type: material.boxType,
    title: material.title || null,
    url: material.url || null,
    local_path: material.localPath || null,
    storage_status: material.storageStatus || 'active',
    file_hash: material.fileHash || null,
    file_size: material.fileSizeBytes || null,
    trashed_at: material.trashedAt ? new Date(material.trashedAt).getTime() : null,
    trash_path: material.trashPath || null,
    created_at: new Date(material.createdAt).getTime(),
  };
}
