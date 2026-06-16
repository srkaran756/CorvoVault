/**
 * VaultPurgeApplicationService unit tests.
 *
 * Exercises the purgeOldTrashedRows() method added in Fix 3, plus the
 * existing purgeProfile() method.  All tests run against an in-memory DB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { VaultPurgeApplicationService } from './VaultPurgeApplicationService';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE topics (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE folders (
      id         TEXT PRIMARY KEY,
      topic_id   TEXT NOT NULL REFERENCES topics(id),
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE materials (
      id             TEXT PRIMARY KEY,
      folder_id      TEXT NOT NULL,
      topic_id       TEXT NOT NULL,
      profile_id     TEXT NOT NULL REFERENCES profiles(id),
      title          TEXT NOT NULL,
      url            TEXT NOT NULL,
      box_type       TEXT NOT NULL DEFAULT 'link',
      storage_status TEXT NOT NULL DEFAULT 'active',
      trashed_at     INTEGER,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE bookmarks         (id TEXT PRIMARY KEY, profile_id TEXT, FOREIGN KEY (profile_id) REFERENCES profiles(id));
    CREATE TABLE activity_log      (id TEXT PRIMARY KEY, profile_id TEXT, FOREIGN KEY (profile_id) REFERENCES profiles(id));
    CREATE TABLE material_notes    (id TEXT PRIMARY KEY, material_id TEXT);
    CREATE TABLE video_progress    (id TEXT PRIMARY KEY, material_id TEXT);
  `);

  db.exec(`
    INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Test', '2025-01-01T00:00:00.000Z');
    INSERT INTO topics   (id, profile_id, name, created_at) VALUES ('t1', 'p1', 'Topic', '2025-01-01T00:00:00.000Z');
    INSERT INTO folders  (id, topic_id, profile_id, name, created_at) VALUES ('f1', 't1', 'p1', 'Folder', '2025-01-01T00:00:00.000Z');
  `);

  return db;
}

function insertMaterial(db: Database.Database, id: string, status: string, trashedAt: number | null): void {
  db.prepare(`
    INSERT INTO materials (id, folder_id, topic_id, profile_id, title, url, box_type, storage_status, trashed_at, created_at)
    VALUES (?, 'f1', 't1', 'p1', ?, 'http://example.com', 'link', ?, ?, '2025-01-01T00:00:00.000Z')
  `).run(id, `Material ${id}`, status, trashedAt);
}

describe('VaultPurgeApplicationService — purgeOldTrashedRows', () => {
  let service: VaultPurgeApplicationService;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    service = new VaultPurgeApplicationService(db);
  });

  it('deletes rows older than the cutoff', () => {
    const now = Date.now();
    const oldMs = now - (40 * 24 * 60 * 60 * 1000); // 40 days ago
    insertMaterial(db, 'm1', 'trashed', oldMs);

    const deleted = service.purgeOldTrashedRows(30);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT * FROM materials WHERE id = ?').get('m1');
    expect(remaining).toBeUndefined();
  });

  it('keeps rows newer than the cutoff', () => {
    const now = Date.now();
    const recentMs = now - (5 * 24 * 60 * 60 * 1000); // 5 days ago
    insertMaterial(db, 'm2', 'trashed', recentMs);

    const deleted = service.purgeOldTrashedRows(30);
    expect(deleted).toBe(0);

    const remaining = db.prepare('SELECT * FROM materials WHERE id = ?').get('m2');
    expect(remaining).toBeDefined();
  });

  it('does not touch active materials', () => {
    const oldMs = Date.now() - (60 * 24 * 60 * 60 * 1000); // 60 days ago
    insertMaterial(db, 'm3', 'active', oldMs); // active, old timestamp

    const deleted = service.purgeOldTrashedRows(30);
    expect(deleted).toBe(0);
  });

  it('does not touch rows with null trashed_at', () => {
    insertMaterial(db, 'm4', 'trashed', null); // trashed but no timestamp

    const deleted = service.purgeOldTrashedRows(30);
    expect(deleted).toBe(0);
  });

  it('only deletes rows beyond the exact cutoff boundary', () => {
    const now = Date.now();
    const exactCutoff = now - (30 * 24 * 60 * 60 * 1000);
    insertMaterial(db, 'm5', 'trashed', exactCutoff - 1); // 1ms older than cutoff → delete
    insertMaterial(db, 'm6', 'trashed', exactCutoff + 1); // 1ms newer → keep

    const deleted = service.purgeOldTrashedRows(30);
    expect(deleted).toBe(1);
    expect(db.prepare('SELECT id FROM materials WHERE id = ?').get('m5')).toBeUndefined();
    expect(db.prepare('SELECT id FROM materials WHERE id = ?').get('m6')).toBeDefined();
  });
});

describe('VaultPurgeApplicationService — purgeProfile', () => {
  let service: VaultPurgeApplicationService;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    service = new VaultPurgeApplicationService(db);
  });

  it('removes all materials for the given profile', () => {
    insertMaterial(db, 'mA', 'active', null);
    insertMaterial(db, 'mB', 'trashed', null);

    service.purgeProfile('p1');

    const count = (db.prepare('SELECT COUNT(*) as c FROM materials WHERE profile_id = ?').get('p1') as any).c;
    expect(count).toBe(0);
  });

  it('does not remove materials for other profiles', () => {
    db.exec(`INSERT INTO profiles (id, name, created_at) VALUES ('p2', 'Other', '2025-01-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO topics   (id, profile_id, name, created_at) VALUES ('t2', 'p2', 'T', '2025-01-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO folders  (id, topic_id, profile_id, name, created_at) VALUES ('f2', 't2', 'p2', 'F', '2025-01-01T00:00:00.000Z')`);
    db.prepare(`INSERT INTO materials (id, folder_id, topic_id, profile_id, title, url, box_type, storage_status, trashed_at, created_at) VALUES ('mX', 'f2', 't2', 'p2', 'X', 'http://x.com', 'link', 'active', NULL, '2025-01-01T00:00:00.000Z')`).run();

    service.purgeProfile('p1');

    const count = (db.prepare('SELECT COUNT(*) as c FROM materials WHERE profile_id = ?').get('p2') as any).c;
    expect(count).toBe(1);
  });
});
