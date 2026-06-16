/**
 * SqliteMaterialRepository — smoke tests.
 *
 * Covers the core CRUD operations and the trashed-at timestamp stamping
 * that trash-purge depends on.  Uses an in-memory SQLite DB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteMaterialRepository } from './SqliteMaterialRepository';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE topics (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id),
      name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id),
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE materials (
      id             TEXT PRIMARY KEY,
      folder_id      TEXT NOT NULL,
      profile_id     TEXT NOT NULL REFERENCES profiles(id),
      title          TEXT,
      url            TEXT,
      local_path     TEXT,
      thumb_url      TEXT,
      box_type       TEXT NOT NULL DEFAULT 'link',
      storage_status TEXT NOT NULL DEFAULT 'active',
      trash_path     TEXT,
      trashed_at     INTEGER,
      file_size      INTEGER,
      file_hash      TEXT,
      metadata       TEXT,
      created_at     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE material_notes (
      id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      content TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Test Profile', '2025-01-01T00:00:00.000Z');
    INSERT INTO topics   (id, profile_id, name, created_at) VALUES ('t1', 'p1', 'Topic', '2025-01-01T00:00:00.000Z');
    INSERT INTO folders  (id, topic_id, profile_id, name, created_at) VALUES ('f1', 't1', 'p1', 'Folder', '2025-01-01T00:00:00.000Z');
  `);

  return db;
}

describe('SqliteMaterialRepository', () => {
  let repo: SqliteMaterialRepository;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    repo = new SqliteMaterialRepository(db);
  });

  it('creates a material and returns it with an id', async () => {
    const m = await repo.create({
      folderId: 'f1', topicId: 't1', profileId: 'p1',
      title: 'My Link', url: 'https://example.com', boxType: 'link',
    });
    expect(m.id).toBeTruthy();
    expect(m.title).toBe('My Link');
    expect(m.storageStatus).toBe('active');
  });

  it('retrieves a material by id', async () => {
    const created = await repo.create({
      folderId: 'f1', topicId: 't1', profileId: 'p1',
      title: 'Find Me', url: 'https://example.com', boxType: 'link',
    });
    const found = await repo.getById(created.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Find Me');
  });

  it('returns null for unknown id', async () => {
    expect(await repo.getById('unknown')).toBeNull();
  });

  it('lists materials by folder', async () => {
    await repo.create({ folderId: 'f1', topicId: 't1', profileId: 'p1', title: 'A', url: 'u', boxType: 'link' });
    await repo.create({ folderId: 'f1', topicId: 't1', profileId: 'p1', title: 'B', url: 'u', boxType: 'link' });
    const items = await repo.getByFolderId('f1', 'p1');
    expect(items.length).toBe(2);
  });

  it('moves material to trash and stamps trashed_at', async () => {
    const m = await repo.create({
      folderId: 'f1', topicId: 't1', profileId: 'p1',
      title: 'Trashable', url: 'u', boxType: 'link',
    });
    const beforeDate = new Date().toISOString();
    await repo.update(m.id, { storageStatus: 'trashed', trashedAt: new Date().toISOString() });
    const updated = await repo.getById(m.id);
    expect(updated!.storageStatus).toBe('trashed');
    expect(updated!.trashedAt).toBeDefined();
    expect(updated!.trashedAt! >= beforeDate).toBe(true);
  });

  it('delete removes the row', async () => {
    const m = await repo.create({
      folderId: 'f1', topicId: 't1', profileId: 'p1',
      title: 'Delete Me', url: 'u', boxType: 'link',
    });
    await repo.delete(m.id);
    expect(await repo.getById(m.id)).toBeNull();
  });
});
