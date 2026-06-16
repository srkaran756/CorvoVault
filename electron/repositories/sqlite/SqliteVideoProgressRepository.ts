import Database from 'better-sqlite3';
import { VideoProgress } from '../../../src/types';

export class SqliteVideoProgressRepository {
  constructor(private db: Database.Database) {}

  async get(materialId: string): Promise<VideoProgress | null> {
    const row = this.db.prepare('SELECT * FROM video_progress WHERE material_id = ?').get(materialId) as any;
    if (!row) return null;
    return {
      materialId: row.material_id,
      profileId: '',
      currentTime: row.current_time,
      duration: row.duration,
      updatedAt: new Date(row.last_watched).toISOString()
    };
  }

  async save(progress: VideoProgress): Promise<void> {
    this.db.prepare(`
      INSERT INTO video_progress (material_id, current_time, duration, last_watched)
      VALUES (@materialId, @currentTime, @duration, @lastWatched)
      ON CONFLICT(material_id) DO UPDATE SET
        current_time = excluded.current_time,
        duration = excluded.duration,
        last_watched = excluded.last_watched
    `).run({
      materialId: progress.materialId,
      currentTime: progress.currentTime,
      duration: progress.duration || null,
      lastWatched: Date.now()
    });
  }
}
