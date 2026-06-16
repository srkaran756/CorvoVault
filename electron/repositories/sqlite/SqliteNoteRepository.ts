import Database from 'better-sqlite3';
import crypto from 'crypto';
import { MaterialNote } from '../../../src/types';
import { NoteRepository } from '../interfaces/NoteRepository';

export class SqliteNoteRepository implements NoteRepository {
  constructor(private db: Database.Database) {}

  async create(noteData: Omit<MaterialNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaterialNote> {
    const note: MaterialNote = {
      ...noteData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO material_notes (id, material_id, content, created_at)
      VALUES (@id, @material_id, @content, @created_at)
    `).run({
      id: note.id,
      material_id: note.materialId,
      content: note.content,
      created_at: new Date(note.createdAt).getTime()
    });

    return note;
  }

  async update(id: string, content: string): Promise<void> {
    this.db.prepare('UPDATE material_notes SET content = ? WHERE id = ?').run(content, id);
    // updatedAt is not in schema but it's fine
  }

  async getByMaterialId(materialId: string): Promise<MaterialNote[]> {
    const rows = this.db.prepare('SELECT * FROM material_notes WHERE material_id = ? ORDER BY created_at ASC').all(materialId) as any[];
    return rows.map(r => ({
      id: r.id,
      materialId: r.material_id,
      profileId: '', // Note: DB schema for notes doesn't have profile_id, we can ignore or fetch it
      content: r.content,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.created_at).toISOString()
    }));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM material_notes WHERE id = ?').run(id);
  }
}
