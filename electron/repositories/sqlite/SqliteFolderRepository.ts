import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Folder } from '../../../src/types';
import { FolderRepository } from '../interfaces/FolderRepository';
import { FolderRow, toFolder, toFolderRow } from '../../mappers/folderMapper';

export class SqliteFolderRepository implements FolderRepository {
  constructor(private db: Database.Database) {}

  async create(folderData: Omit<Folder, 'id' | 'createdAt'>): Promise<Folder> {
    const folder: Folder = {
      ...folderData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    const row = toFolderRow(folder);

    this.db.prepare(`
      INSERT INTO folders (id, topic_id, profile_id, name, created_at)
      VALUES (@id, @topic_id, @profile_id, @name, @created_at)
    `).run(row as any);

    return folder;
  }

  async update(id: string, updates: Partial<Folder>): Promise<void> {
    if (updates.name) {
      this.db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(updates.name, id);
    }
  }

  async getById(id: string): Promise<Folder | null> {
    const row = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
    if (!row) return null;
    return toFolder(row);
  }

  async getByTopicId(topicId: string): Promise<Folder[]> {
    const rows = this.db.prepare('SELECT * FROM folders WHERE topic_id = ? ORDER BY created_at DESC').all(topicId) as FolderRow[];
    return rows.map(toFolder);
  }

  async getByProfileId(profileId: string): Promise<Folder[]> {
    const rows = this.db.prepare(
      'SELECT * FROM folders WHERE profile_id = ? ORDER BY created_at DESC'
    ).all(profileId) as FolderRow[];
    return rows.map(toFolder);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  }
}
