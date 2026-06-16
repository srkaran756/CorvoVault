import { NoteRepository } from '../repositories/interfaces/NoteRepository';

export class NoteApplicationService {
  constructor(private noteRepo: NoteRepository) {}

  async getNotes(materialId: string) {
    return this.noteRepo.getByMaterialId(materialId);
  }

  async addNote(materialId: string, content: string) {
    return this.noteRepo.create({ materialId, content, profileId: '' });
  }

  async updateNote(id: string, content: string) {
    return this.noteRepo.update(id, content);
  }

  async deleteNote(id: string) {
    return this.noteRepo.delete(id);
  }
}
