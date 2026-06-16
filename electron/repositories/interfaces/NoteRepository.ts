import { MaterialNote } from '../../../src/types';

export interface NoteRepository {
  create(note: Omit<MaterialNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaterialNote>;
  update(id: string, content: string): Promise<void>;
  getByMaterialId(materialId: string): Promise<MaterialNote[]>;
  delete(id: string): Promise<void>;
}
