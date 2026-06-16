import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Bookmark, BookmarkRepository } from '../interfaces/BookmarkRepository';

export class SqliteBookmarkRepository implements BookmarkRepository {
  constructor(private db: Database.Database) {}

  async create(bookmarkData: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark> {
    const bookmark: Bookmark = {
      ...bookmarkData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };

    this.db.prepare(`
      INSERT INTO bookmarks (id, profile_id, url, title, created_at)
      VALUES (@id, @profile_id, @url, @title, @created_at)
    `).run({
      id: bookmark.id,
      profile_id: bookmark.profileId,
      url: bookmark.url,
      title: bookmark.title || null,
      created_at: new Date(bookmark.createdAt).getTime()
    });

    return bookmark;
  }

  async getByProfileId(profileId: string): Promise<Bookmark[]> {
    const rows = this.db.prepare('SELECT * FROM bookmarks WHERE profile_id = ? ORDER BY created_at DESC').all(profileId) as any[];
    return rows.map(r => ({
      id: r.id,
      profileId: r.profile_id,
      url: r.url,
      title: r.title || '',
      createdAt: new Date(r.created_at).toISOString()
    }));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }
}
