import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Activity } from '../../../src/types';
import { ActivityRepository } from '../interfaces/ActivityRepository';

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private db: Database.Database) {}

  async log(profileId: string, action: string, metadata?: Record<string, any>): Promise<void> {
    this.db.prepare(`
      INSERT INTO activity_log (id, profile_id, action, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      profileId,
      action,
      metadata ? JSON.stringify(metadata) : null,
      Date.now()
    );
  }

  async getByProfileId(profileId: string, limit: number = 100): Promise<Activity[]> {
    const rows = this.db.prepare(`
      SELECT * FROM activity_log 
      WHERE profile_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(profileId, limit) as any[];

    // This returns the Activity model format expected by the frontend
    return rows.map(r => {
      const meta = r.metadata ? JSON.parse(r.metadata) : {};
      return {
        id: r.id,
        title: meta.title || r.action,
        time: new Date(r.created_at).toISOString(),
        type: meta.type || 'edit',
        icon: meta.icon || 'Activity',
        colorClass: meta.colorClass || 'bg-gray-100'
      };
    });
  }

  async getHeatmap(profileId: string, days: number): Promise<any[]> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.db.prepare(`
      SELECT 
        date(created_at / 1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as count
      FROM activity_log
      WHERE profile_id = ? AND created_at >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(profileId, cutoff) as any[];
    return rows;
  }

  async getWeekSummary(profileId: string): Promise<any> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const usageRows = this.db.prepare(`
      SELECT app_category, SUM(minutes) as total_minutes
      FROM daily_usage
      WHERE profile_id = ? AND received_at >= ?
      GROUP BY app_category
    `).all(profileId, cutoff) as any[];

    const totalMinutesResult = this.db.prepare(`
      SELECT SUM(minutes) as total
      FROM daily_usage
      WHERE profile_id = ? AND received_at >= ?
    `).get(profileId, cutoff) as { total: number | null };

    const totalMinutes = totalMinutesResult?.total || 0;
    const byCategory: Record<string, number> = {};
    for (const r of usageRows) {
      if (r.app_category) {
        byCategory[r.app_category] = r.total_minutes;
      }
    }

    return {
      totalMinutes,
      dailyAverage: Math.round(totalMinutes / 7),
      byCategory
    };
  }

  async getTopDistractors(profileId: string, days: number): Promise<any[]> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this.db.prepare(`
      SELECT app_name as name, SUM(minutes) as minutes, app_category as category
      FROM daily_usage
      WHERE profile_id = ? AND received_at >= ?
      GROUP BY app_name
      ORDER BY minutes DESC
      LIMIT 5
    `).all(profileId, cutoff) as any[];
    return rows;
  }

  async logMobileUsage(profileId: string, data: any): Promise<void> {
    const id = crypto.randomUUID();
    const receivedAt = Date.now();
    const date = data.date || new Date().toISOString().split('T')[0];
    const time = data.time || new Date().toISOString().split('T')[1].substring(0, 5);
    const source = data.source || 'mobile';

    this.db.prepare(`
      INSERT INTO daily_usage (id, profile_id, date, time, app_name, app_package, app_category, minutes, source, device_id, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      profileId,
      date,
      time,
      data.appName || 'Unknown App',
      data.appPackage || null,
      data.appCategory || null,
      data.minutes || 0,
      source,
      data.deviceId || null,
      receivedAt
    );
  }
}
