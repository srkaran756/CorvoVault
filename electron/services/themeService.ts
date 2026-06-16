import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';

export class ThemeService {
  constructor(private db: Database.Database) {}

  // ─── Theme ─────────────────────────────────────────────────

  async getTheme(profileId: string): Promise<Record<string, string>> {
    const row = this.db.prepare(
      'SELECT theme_data FROM profile_theme WHERE profile_id = ?'
    ).get(profileId) as { theme_data: string } | undefined;

    if (row) {
      try { return JSON.parse(row.theme_data); } catch {}
    }

    // Fall back to legacy JSON file (one-time migration)
    const legacyTheme = this.readLegacyTheme(profileId);
    if (legacyTheme) {
      await this.saveTheme(profileId, legacyTheme);
      this.deleteLegacyTheme(profileId);
      return legacyTheme;
    }

    return {};
  }

  async saveTheme(profileId: string, data: Record<string, string>): Promise<void> {
    // Upsert — read existing overrides so we don't clobber them
    const existing = this.db.prepare(
      'SELECT overrides_data FROM profile_theme WHERE profile_id = ?'
    ).get(profileId) as { overrides_data: string } | undefined;

    const overridesData = existing?.overrides_data ?? '{}';

    this.db.prepare(`
      INSERT INTO profile_theme (profile_id, theme_data, overrides_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET theme_data = excluded.theme_data, updated_at = excluded.updated_at
    `).run(profileId, JSON.stringify(data), overridesData, Date.now());
  }

  // ─── CSS Overrides ─────────────────────────────────────────

  async getOverrides(profileId: string): Promise<Record<string, Record<string, string>>> {
    const row = this.db.prepare(
      'SELECT overrides_data FROM profile_theme WHERE profile_id = ?'
    ).get(profileId) as { overrides_data: string } | undefined;

    if (row) {
      try { return JSON.parse(row.overrides_data); } catch {}
    }

    // Fall back to legacy JSON file (one-time migration)
    const legacyOverrides = this.readLegacyOverrides(profileId);
    if (legacyOverrides) {
      await this.saveOverrides(profileId, legacyOverrides);
      this.deleteLegacyOverrides(profileId);
      return legacyOverrides;
    }

    return {};
  }

  async saveOverrides(profileId: string, data: Record<string, Record<string, string>>): Promise<void> {
    // Upsert — read existing theme so we don't clobber it
    const existing = this.db.prepare(
      'SELECT theme_data FROM profile_theme WHERE profile_id = ?'
    ).get(profileId) as { theme_data: string } | undefined;

    const themeData = existing?.theme_data ?? '{}';

    this.db.prepare(`
      INSERT INTO profile_theme (profile_id, theme_data, overrides_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET overrides_data = excluded.overrides_data, updated_at = excluded.updated_at
    `).run(profileId, themeData, JSON.stringify(data), Date.now());
  }

  async resetToDefault(profileId: string): Promise<void> {
    this.db.prepare(
      `UPDATE profile_theme SET theme_data = '{}', overrides_data = '{}', updated_at = ? WHERE profile_id = ?`
    ).run(Date.now(), profileId);
  }

  // ─── Legacy migration helpers ───────────────────────────────

  private legacyThemePath(profileId: string) {
    return path.join(app.getPath('userData'), `theme_${profileId}.json`);
  }

  private legacyOverridesPath(profileId: string) {
    return path.join(app.getPath('userData'), `overrides_${profileId}.json`);
  }

  private readLegacyTheme(profileId: string): Record<string, string> | null {
    const p = this.legacyThemePath(profileId);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  private readLegacyOverrides(profileId: string): Record<string, Record<string, string>> | null {
    const p = this.legacyOverridesPath(profileId);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  private deleteLegacyTheme(profileId: string) {
    const p = this.legacyThemePath(profileId);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }

  private deleteLegacyOverrides(profileId: string) {
    const p = this.legacyOverridesPath(profileId);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
}
