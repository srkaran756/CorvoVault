import { ipcMain, app } from 'electron';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { ServiceHost } from '../ServiceHost';
import { readJournal, writeJournal, MigrationJournal } from '../db/migrationJournal';
import { importFromSnapshot } from '../db/seed';
import { closeDb } from '../db/connection';

export function registerMigrationHandlers(db: Database.Database, serviceHost: ServiceHost) {
  ipcMain.handle('migration:getStatus', async () => {
    return readJournal();
  });

  ipcMain.handle('migration:exportComplete', async (_evt, snapshot: unknown) => {
    const snap = snapshot as Record<string, unknown>;
    if (!snap || typeof snap !== 'object') {
      return { success: false, error: 'Invalid snapshot payload' };
    }

    // 1. Write legacy backup
    const backupPath = path.join(app.getPath('userData'), 'legacy-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(snap, null, 2), 'utf8');

    // 2. Count source
    const source_counts = {
      profiles: Array.isArray(snap.profiles) ? snap.profiles.length : 0,
      topics: Array.isArray(snap.topics) ? snap.topics.length : 0,
      folders: Array.isArray(snap.folders) ? snap.folders.length : 0,
      materials: Array.isArray(snap.materials) ? snap.materials.length : 0,
      notes: Array.isArray(snap.notes) ? snap.notes.length : 0,
      bookmarks: Array.isArray(snap.bookmarks) ? snap.bookmarks.length : 0,
    };

    const journal: MigrationJournal = {
      state: 'IMPORTING',
      started_at: Date.now(),
      source_counts
    };
    writeJournal(journal);

    // 3. Import
    try {
      await importFromSnapshot(db, serviceHost, snap);
      
      // 4. Validate by QUERYING THE DB — not by counting insert attempts
      // This is correct because INSERT OR IGNORE won't fail if data already exists
      const db_counts: Record<string, number> = {
        profiles: (db.prepare('SELECT COUNT(*) as c FROM profiles').get() as any)?.c ?? 0,
        topics: (db.prepare('SELECT COUNT(*) as c FROM topics').get() as any)?.c ?? 0,
        folders: (db.prepare('SELECT COUNT(*) as c FROM folders').get() as any)?.c ?? 0,
        materials: (db.prepare('SELECT COUNT(*) as c FROM materials').get() as any)?.c ?? 0,
        notes: (db.prepare('SELECT COUNT(*) as c FROM material_notes').get() as any)?.c ?? 0,
        bookmarks: (db.prepare('SELECT COUNT(*) as c FROM bookmarks').get() as any)?.c ?? 0,
      };

      let match = true;
      for (const key of Object.keys(source_counts)) {
        const sourceVal = (source_counts as any)[key];
        const dbVal = db_counts[key];
        // DB count must be >= source (it may have had records from before)
        if (dbVal < sourceVal) {
          match = false;
          console.error(`[Migration] Shortfall on ${key}: source=${sourceVal}, db=${dbVal}`);
        }
      }

      if (match) {
        journal.state = 'COMPLETE';
        journal.completed_at = Date.now();
        journal.validated = true;
        writeJournal(journal);
        return { success: true };
      } else {
        throw new Error('Validation failed: DB has fewer records than source.');
      }
    } catch (err) {
      console.error('[Migration] Failed:', err);
      
      // Rollback: delete the SQLite file
      // IMPORTANT: We must close the db connection BEFORE unlinking the file.
      // We cannot reuse the same `db` reference after close.
      try {
        closeDb();
      } catch (closeErr) {
        console.error('[Migration] Failed to close db on rollback:', closeErr);
      }
      
      const dbPath = path.join(app.getPath('userData'), 'corvovault.db');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('[Migration] Rolled back: corvovault.db deleted.');
      }

      journal.state = 'ROLLED_BACK';
      writeJournal(journal);
      
      // NOTE: After rollback, restart the app so the next getDb() opens a fresh file.
      // This is communicated to the user via the ROLLED_BACK UI state.
      return { success: false, error: String(err) };
    }
  });
}
