import { AppSettings, UserStats } from '../../src/types';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';

const DEFAULT_WELLBEING = [
  { id: '1', title: 'YouTube',     type: 'Video',    minutes: 0, color: '#ef4444' },
  { id: '2', title: 'Documents',   type: 'Reading',  minutes: 0, color: '#22c55e' },
  { id: '3', title: 'Web Browser', type: 'Research', minutes: 0, color: '#3b82f6' },
  { id: '4', title: 'Notes',       type: 'Writing',  minutes: 0, color: '#f59e0b' },
];

export class SettingsService {
  constructor(private db: Database.Database) {}

  // ─── Settings ──────────────────────────────────────────────

  async getSettings(profileId: string): Promise<AppSettings> {
    // 1. Try SQLite first (the new authoritative source)
    const row = this.db.prepare(
      'SELECT data FROM profile_settings WHERE profile_id = ?'
    ).get(profileId) as { data: string } | undefined;

    if (row) {
      try {
        return JSON.parse(row.data) as AppSettings;
      } catch {}
    }

    // 2. Fall back to legacy JSON file (one-time migration on first read)
    const legacyData = this.readLegacySettings(profileId);
    if (legacyData) {
      await this.saveSettings(profileId, legacyData);
      this.deleteLegacySettings(profileId);
      return legacyData;
    }

    // 3. Defaults
    return { profileId, studyTargetMinutes: 240, focusTimeMinutes: 25 };
  }

  async saveSettings(profileId: string, data: AppSettings): Promise<void> {
    this.db.prepare(`
      INSERT INTO profile_settings (profile_id, data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(profileId, JSON.stringify(data), Date.now());
  }

  // ─── Stats ─────────────────────────────────────────────────

  async getStats(profileId: string): Promise<UserStats> {
    // 1. Try SQLite
    const row = this.db.prepare(
      'SELECT data FROM profile_stats WHERE profile_id = ?'
    ).get(profileId) as { data: string } | undefined;

    if (row) {
      try {
        return JSON.parse(row.data) as UserStats;
      } catch {}
    }

    // 2. Fall back to legacy JSON file (one-time migration)
    const legacyData = this.readLegacyStats(profileId);
    if (legacyData) {
      await this.saveStats(profileId, legacyData);
      this.deleteLegacyStats(profileId);
      return legacyData;
    }

    // 3. Defaults
    return {
      profileId,
      studyTimeMinutes: 0,
      aiTokenUsage: 0,
      lastActiveAt: new Date().toISOString(),
      wellbeingData: DEFAULT_WELLBEING,
    };
  }

  async saveStats(profileId: string, data: UserStats): Promise<void> {
    this.db.prepare(`
      INSERT INTO profile_stats (profile_id, data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(profileId, JSON.stringify(data), Date.now());
  }

  // ─── Legacy migration helpers ───────────────────────────────

  private legacySettingsPath(profileId: string) {
    return path.join(app.getPath('userData'), `settings_${profileId}.json`);
  }

  private legacyStatsPath(profileId: string) {
    return path.join(app.getPath('userData'), `stats_${profileId}.json`);
  }

  private readLegacySettings(profileId: string): AppSettings | null {
    const p = this.legacySettingsPath(profileId);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  private readLegacyStats(profileId: string): UserStats | null {
    const p = this.legacyStatsPath(profileId);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  private deleteLegacySettings(profileId: string) {
    const p = this.legacySettingsPath(profileId);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }

  private deleteLegacyStats(profileId: string) {
    const p = this.legacyStatsPath(profileId);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
}
