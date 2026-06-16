import Database from 'better-sqlite3';

/**
 * Deletes all vault data for a profile (SQLite rows). Caller must delete filesystem blobs separately.
 */
export class VaultPurgeApplicationService {
  constructor(private db: Database.Database) {}

  purgeProfile(profileId: string): void {
    this.db.transaction(() => {
      this.db.prepare(
        'DELETE FROM material_notes WHERE material_id IN (SELECT id FROM materials WHERE profile_id = ?)'
      ).run(profileId);
      this.db.prepare('DELETE FROM video_progress WHERE material_id IN (SELECT id FROM materials WHERE profile_id = ?)').run(profileId);
      this.db.prepare('DELETE FROM bookmarks WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM materials WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM folders WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM topics WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM activity_log WHERE profile_id = ?').run(profileId);
    })();
  }

  async getMaterialsByProfile(profileId: string) {
    return this.db.prepare('SELECT * FROM materials WHERE profile_id = ?').all(profileId) as any[];
  }

  /**
   * Deletes SQLite rows for materials that have been in the trash longer than
   * `olderThanDays` days.  This is the DB-side companion to the filesystem purge
   * in the `file:purgeTrash` IPC handler — both must run together to keep the
   * database and disk in sync.
   *
   * @returns The number of rows deleted.
   */
  purgeOldTrashedRows(olderThanDays: number): number {
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      `DELETE FROM materials
       WHERE storage_status = 'trashed'
         AND trashed_at IS NOT NULL
         AND trashed_at < ?`
    ).run(cutoffMs);
    return result.changes;
  }
}
