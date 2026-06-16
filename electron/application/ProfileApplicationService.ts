import Database from 'better-sqlite3';

export class ProfileApplicationService {
  constructor(private db: Database.Database) {}

  ensureProfile(profileId: string, name = 'Local Profile', avatarPath?: string | null): void {
    this.db.prepare(`
      INSERT INTO profiles (id, name, avatar_path, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, profiles.name),
        avatar_path = COALESCE(excluded.avatar_path, profiles.avatar_path)
    `).run(profileId, name || 'Local Profile', avatarPath || null, Date.now());
  }

  async syncProfiles(profiles: Array<{ id: string; name?: string; photoURL?: string; avatar_path?: string }>): Promise<void> {
    this.db.transaction(() => {
      for (const profile of profiles) {
        if (!profile?.id) continue;
        this.ensureProfile(profile.id, profile.name || 'Local Profile', profile.photoURL || profile.avatar_path || null);
      }
    })();
  }
}
