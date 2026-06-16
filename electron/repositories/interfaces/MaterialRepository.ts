import { Material } from '../../../src/types';

export interface MaterialRepository {
  create(material: Omit<Material, 'id' | 'createdAt'>): Promise<Material>;

  update(id: string, updates: Partial<Material>): Promise<void>;
  getById(id: string): Promise<Material | null>;
  getByFolderId(folderId: string, profileId: string): Promise<Material[]>;
  getAll(profileId: string): Promise<Material[]>;
  getTrashed(profileId: string): Promise<Material[]>;
  search(profileId: string, query: string): Promise<Material[]>;
  setStorageStatus(id: string, status: Material['storageStatus'], trashPath?: string): Promise<void>;
  delete(id: string): Promise<void>;
  getCounts(profileId: string): { files: number; links: number; youtubes: number; notes: number; total: number };
}
