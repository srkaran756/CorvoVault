import Database from 'better-sqlite3';
import { Material } from '../../../src/types';
import { MaterialRepository } from '../interfaces/MaterialRepository';
import { MaterialRow, toMaterial, toMaterialRow } from '../../mappers/materialMapper';
import crypto from 'crypto';

export class SqliteMaterialRepository implements MaterialRepository {
  constructor(private db: Database.Database) {}

  async create(materialData: Omit<Material, 'id' | 'createdAt'>): Promise<Material> {
    const material: Material = {
      ...materialData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      storageStatus: materialData.storageStatus || 'active'
    };
    
    const row = toMaterialRow(material);

    this.db.prepare(`
      INSERT INTO materials (
        id, folder_id, profile_id, box_type, title, url, 
        local_path, storage_status, file_hash, file_size, 
        trashed_at, trash_path, created_at
      ) VALUES (
        @id, @folder_id, @profile_id, @box_type, @title, @url,
        @local_path, @storage_status, @file_hash, @file_size,
        @trashed_at, @trash_path, @created_at
      )
    `).run(row as any);

    return material;
  }

  async update(id: string, updates: Partial<Material>): Promise<void> {
    const params: Record<string, any> = { id };
    const sets: string[] = [];

    if ('title' in updates) { sets.push('title = @title'); params['title'] = updates.title; }
    if ('storageStatus' in updates) { sets.push('storage_status = @storageStatus'); params['storageStatus'] = updates.storageStatus; }
    if ('trashedAt' in updates) { sets.push('trashed_at = @trashedAt'); params['trashedAt'] = updates.trashedAt ? new Date(updates.trashedAt).getTime() : null; }
    if ('trashPath' in updates) { sets.push('trash_path = @trashPath'); params['trashPath'] = updates.trashPath || null; }
    
    if (sets.length === 0) return;

    this.db.prepare(`UPDATE materials SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  async getById(id: string): Promise<Material | null> {
    const row = this.db.prepare(`
      SELECT m.*, f.topic_id 
      FROM materials m
      LEFT JOIN folders f ON f.id = m.folder_id
      WHERE m.id = ?
    `).get(id) as (MaterialRow & { topic_id: string }) | undefined;
    if (!row) return null;
    
    const material = toMaterial(row);
    material.topicId = row.topic_id || '';
    return material;
  }

  async getByFolderId(folderId: string, profileId: string): Promise<Material[]> {
    const rows = this.db.prepare(`
      SELECT m.*, f.topic_id 
      FROM materials m
      LEFT JOIN folders f ON f.id = m.folder_id
      WHERE m.folder_id = ? AND m.profile_id = ? AND m.storage_status = 'active' 
      ORDER BY m.created_at DESC
    `).all(folderId, profileId) as (MaterialRow & { topic_id: string })[];

    return rows.map(r => {
      const m = toMaterial(r);
      m.topicId = r.topic_id || '';
      return m;
    });
  }
  
  async getAll(profileId: string): Promise<Material[]> {
    const rows = this.db.prepare(`
      SELECT m.*, f.topic_id 
      FROM materials m
      LEFT JOIN folders f ON f.id = m.folder_id
      WHERE m.profile_id = ? AND m.storage_status = 'active' 
      ORDER BY m.created_at DESC
    `).all(profileId) as (MaterialRow & { topic_id: string })[];

    return rows.map(r => {
      const m = toMaterial(r);
      m.topicId = r.topic_id || '';
      return m;
    });
  }

  async getTrashed(profileId: string): Promise<Material[]> {
    const rows = this.db.prepare(`
      SELECT m.*, f.topic_id 
      FROM materials m
      LEFT JOIN folders f ON f.id = m.folder_id
      WHERE m.profile_id = ? AND m.storage_status = 'trashed' 
      ORDER BY m.trashed_at DESC
    `).all(profileId) as (MaterialRow & { topic_id: string; trash_path?: string })[];

    return rows.map(r => {
      const m = toMaterial(r);
      m.topicId = r.topic_id || '';
      if (r.trash_path) m.trashPath = r.trash_path;
      return m;
    });
  }

  async search(profileId: string, query: string): Promise<Material[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const ftsQuery = trimmedQuery
      .split(/\s+/)
      .map(term => `"${term.replace(/"/g, '""')}"`)
      .join(' ');

    try {
      const rows = this.db.prepare(`
        SELECT m.*, f.topic_id
        FROM materials m
        JOIN materials_fts fts ON m.rowid = fts.rowid
        LEFT JOIN folders f ON f.id = m.folder_id
        WHERE materials_fts MATCH ?
          AND m.profile_id = ?
          AND m.storage_status = 'active'
        ORDER BY rank
      `).all(ftsQuery, profileId) as (MaterialRow & { topic_id: string })[];

      return rows.map(r => {
        const material = toMaterial(r);
        material.topicId = r.topic_id || '';
        return material;
      });
    } catch (err) {
      console.warn('[Vault] FTS search failed; falling back to LIKE search.', err);
      const likeQuery = `%${trimmedQuery}%`;
      const rows = this.db.prepare(`
        SELECT m.*, f.topic_id
        FROM materials m
        LEFT JOIN folders f ON f.id = m.folder_id
        WHERE m.profile_id = ?
          AND m.storage_status = 'active'
          AND (m.title LIKE ? OR m.url LIKE ?)
        ORDER BY m.created_at DESC
      `).all(profileId, likeQuery, likeQuery) as (MaterialRow & { topic_id: string })[];

      return rows.map(r => {
        const material = toMaterial(r);
        material.topicId = r.topic_id || '';
        return material;
      });
    }
  }

  async setStorageStatus(id: string, status: Material['storageStatus'], trashPath?: string): Promise<void> {
    const trashedAt = status === 'trashed' ? Date.now() : null;
    const clearTrashPath = status === 'active' ? null : undefined;
    
    if (trashPath !== undefined) {
      // Storing to trash: persist trashPath
      this.db.prepare(
        'UPDATE materials SET storage_status = ?, trashed_at = ?, trash_path = ? WHERE id = ?'
      ).run(status, trashedAt, trashPath, id);
    } else if (clearTrashPath === null) {
      // Restoring from trash: clear trashPath
      this.db.prepare(
        'UPDATE materials SET storage_status = ?, trashed_at = NULL, trash_path = NULL WHERE id = ?'
      ).run(status, id);
    } else {
      this.db.prepare(
        'UPDATE materials SET storage_status = ?, trashed_at = ? WHERE id = ?'
      ).run(status, trashedAt, id);
    }
  }

  async delete(id: string): Promise<void> {
    this.db.transaction(() => {
      const tableExists = (tableName: string) => {
        return !!this.db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(tableName);
      };

      // 1. Delete associated vectors from vec_chunks using rowids mapped to this material
      if (tableExists('vec_chunks')) {
        this.db.prepare(`
          DELETE FROM vec_chunks 
          WHERE rowid IN (SELECT rowid FROM vec_chunk_map WHERE material_id = ?)
        `).run(id);
      }

      // 2. Delete entries in vec_chunk_map
      if (tableExists('vec_chunk_map')) {
        this.db.prepare('DELETE FROM vec_chunk_map WHERE material_id = ?').run(id);
      }

      // 3. Delete text chunks in document_chunks
      if (tableExists('document_chunks')) {
        this.db.prepare('DELETE FROM document_chunks WHERE material_id = ?').run(id);
      }

      // 4. Delete the material itself
      this.db.prepare('DELETE FROM materials WHERE id = ?').run(id);
    })();
  }

  /**
   * Returns active material counts grouped by box_type.
   * Single SQL GROUP BY query — O(1) cost vs. loading all rows.
   */
  getCounts(profileId: string): { files: number; links: number; youtubes: number; notes: number; total: number } {
    const rows = this.db.prepare(`
      SELECT box_type, COUNT(*) as cnt
      FROM materials
      WHERE profile_id = ? AND storage_status = 'active'
      GROUP BY box_type
    `).all(profileId) as Array<{ box_type: string; cnt: number }>;

    const map: Record<string, number> = {};
    for (const r of rows) map[r.box_type] = r.cnt;

    const files = map['file'] ?? 0;
    const links = map['link'] ?? 0;
    const youtubes = map['youtube'] ?? 0;
    const notes = map['note'] ?? 0;
    return { files, links, youtubes, notes, total: files + links + youtubes + notes };
  }
}

