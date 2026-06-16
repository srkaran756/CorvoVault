import { Folder } from '../../../src/types';

export interface FolderRepository {
  create(folder: Omit<Folder, 'id' | 'createdAt'>): Promise<Folder>;
  update(id: string, updates: Partial<Folder>): Promise<void>;
  getById(id: string): Promise<Folder | null>;
  getByTopicId(topicId: string): Promise<Folder[]>;
  getByProfileId(profileId: string): Promise<Folder[]>;
  delete(id: string): Promise<void>;
}
