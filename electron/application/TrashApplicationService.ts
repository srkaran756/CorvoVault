import Database from 'better-sqlite3';
import crypto from 'crypto';
import { ProfileApplicationService } from './ProfileApplicationService';

export class TrashApplicationService {
  constructor(
    private db: Database.Database,
    private profiles: ProfileApplicationService
  ) {}

  moveMaterialToTrash(id: string, profileId: string, trashPath?: string): void {
    this.profiles.ensureProfile(profileId);
    this.db.transaction(() => {
      this.db.prepare(
        'UPDATE materials SET storage_status = ?, trashed_at = ?, trash_path = ? WHERE id = ?'
      ).run('trashed', Date.now(), trashPath || null, id);
      this.db.prepare(`
        INSERT INTO activity_log (id, profile_id, action, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        profileId,
        'Moved to trash',
        JSON.stringify({ id, type: 'delete' }),
        Date.now()
      );
    })();
  }

  restoreMaterial(id: string, profileId: string): void {
    this.profiles.ensureProfile(profileId);
    this.db.transaction(() => {
      this.db.prepare(
        'UPDATE materials SET storage_status = ?, trashed_at = NULL, trash_path = NULL WHERE id = ?'
      ).run('active', id);
      this.db.prepare(`
        INSERT INTO activity_log (id, profile_id, action, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        profileId,
        'Restored from trash',
        JSON.stringify({ id, type: 'restore' }),
        Date.now()
      );
    })();
  }

  async getTrashPath(id: string): Promise<string | null> {
    const row = this.db.prepare('SELECT trash_path FROM materials WHERE id = ?').get(id) as { trash_path?: string } | undefined;
    return row?.trash_path || null;
  }
}
