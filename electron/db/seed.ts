import Database from 'better-sqlite3';
import { ServiceHost } from '../ServiceHost';

export async function importFromSnapshot(
  db: Database.Database,
  serviceHost: ServiceHost,
  snapshot: Record<string, unknown>
): Promise<{ counts: Record<string, number> }> {
  const counts: Record<string, number> = {
    profiles: 0, topics: 0, folders: 0,
    materials: 0, notes: 0, bookmarks: 0
  };

  db.transaction(() => {
    // 1. Profiles
    if (snapshot.profiles && Array.isArray(snapshot.profiles)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO profiles (id, name, avatar_path, created_at) VALUES (?, ?, ?, ?)');
      for (const p of snapshot.profiles as Array<{ id: string; name?: string; photoURL?: string }>) {
        stmt.run(p.id, p.name || 'Default User', p.photoURL || null, Date.now());
        counts.profiles++;
      }
    }

    // 2. Topics
    if (snapshot.topics && Array.isArray(snapshot.topics)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO topics (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)');
      for (const t of snapshot.topics as Array<{ id: string; profileId: string; name: string; createdAt?: string }>) {
        stmt.run(t.id, t.profileId, t.name, t.createdAt ? new Date(t.createdAt).getTime() : Date.now());
        counts.topics++;
      }
    }

    // 3. Folders
    if (snapshot.folders && Array.isArray(snapshot.folders)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO folders (id, topic_id, profile_id, name, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const f of snapshot.folders as Array<{ id: string; topicId: string; profileId: string; name: string; createdAt?: string }>) {
        stmt.run(f.id, f.topicId, f.profileId, f.name, f.createdAt ? new Date(f.createdAt).getTime() : Date.now());
        counts.folders++;
      }
    }

    // 4. Materials
    if (snapshot.materials && Array.isArray(snapshot.materials)) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO materials (
          id, folder_id, profile_id, box_type, title, url, 
          local_path, storage_status, file_hash, file_size, 
          trashed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const m of snapshot.materials as Array<{
        id: string; folderId: string; profileId: string; boxType: string;
        title?: string; url?: string; localPath?: string; storageStatus?: string;
        fileHash?: string; fileSizeBytes?: number; trashedAt?: string; createdAt?: string;
      }>) {
        stmt.run(
          m.id,
          m.folderId,
          m.profileId,
          m.boxType,
          m.title || null,
          m.url || null,
          m.localPath || null,
          m.storageStatus || 'active',
          m.fileHash || null,
          m.fileSizeBytes || null,
          m.trashedAt ? new Date(m.trashedAt).getTime() : null,
          m.createdAt ? new Date(m.createdAt).getTime() : Date.now()
        );
        counts.materials++;
      }
    }

    // 5. Notes
    if (snapshot.notes && Array.isArray(snapshot.notes)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO material_notes (id, material_id, content, created_at) VALUES (?, ?, ?, ?)');
      for (const n of snapshot.notes as Array<{ id: string; materialId: string; content: string; createdAt?: string }>) {
        stmt.run(n.id, n.materialId, n.content, n.createdAt ? new Date(n.createdAt).getTime() : Date.now());
        counts.notes++;
      }
    }

    // 6. Bookmarks
    if (snapshot.bookmarks && Array.isArray(snapshot.bookmarks)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO bookmarks (id, profile_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)');
      const prof0 = (snapshot.profiles as Array<{ id: string }> | undefined)?.[0]?.id || 'default-user';
      for (const b of snapshot.bookmarks as Array<{ id: string; profileId?: string; url: string; title?: string; createdAt?: string }>) {
        stmt.run(b.id, b.profileId || prof0, b.url, b.title || null, b.createdAt ? new Date(b.createdAt).getTime() : Date.now());
        counts.bookmarks++;
      }
    }
  })();

  // Post-transaction: filesystem + keytar (async) — must not run inside SQL transaction
  if (snapshot.settings && Array.isArray(snapshot.settings)) {
    for (const setting of snapshot.settings as Array<Record<string, unknown> & { profileId: string }>) {
      const { geminiKey, openaiKey, anthropicKey, ...rest } = setting;
      await serviceHost.settings.saveSettings(setting.profileId, rest as any);

      if (typeof geminiKey === 'string' && geminiKey) {
        await serviceHost.secrets.saveKey(setting.profileId, 'gemini', geminiKey);
      }
      if (typeof openaiKey === 'string' && openaiKey) {
        await serviceHost.secrets.saveKey(setting.profileId, 'openai', openaiKey);
      }
      if (typeof anthropicKey === 'string' && anthropicKey) {
        await serviceHost.secrets.saveKey(setting.profileId, 'anthropic', anthropicKey);
      }
    }
  }

  if (snapshot.theme && typeof snapshot.theme === 'object' && snapshot.theme !== null) {
    for (const [profileId, theme] of Object.entries(snapshot.theme as Record<string, unknown>)) {
      await serviceHost.theme.saveTheme(profileId, theme as any);
    }
  }

  if (snapshot.overrides && typeof snapshot.overrides === 'object' && snapshot.overrides !== null) {
    for (const [profileId, override] of Object.entries(snapshot.overrides as Record<string, unknown>)) {
      await serviceHost.theme.saveOverrides(profileId, override as any);
    }
  }

  return { counts };
}
