import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = path.join(app.getPath('userData'), 'corvovault.db');
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore double-close / invalid state
    }
    _db = null;
  }
}

/** After deleting corvovault.db or closing the DB handle externally, ensure singleton is cleared. */
export function resetDbConnection(): void {
  closeDb();
}
