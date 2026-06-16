/**
 * SqliteFolderRepository unit tests.
 *
 * Uses an in-memory better-sqlite3 database so these tests run without
 * Electron and without touching any files on disk.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteFolderRepository } from './SqliteFolderRepository';

// Minimal schema — only what FolderRepository needs
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE topics (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE folders (
      id         TEXT PRIMARY KEY,
      topic_id   TEXT NOT NULL REFERENCES topics(id),
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Seed a profile and topic so FK constraints pass (using integer timestamps to match production)
  db.exec(`
    INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Test Profile', 1735689600000);
    INSERT INTO topics  (id, profile_id, name, created_at) VALUES ('t1', 'p1', 'Topic One', 1735689600000);
  `);

  return db;
}

describe('SqliteFolderRepository', () => {
  let repo: SqliteFolderRepository;

  beforeEach(() => {
    repo = new SqliteFolderRepository(createTestDb());
  });

  it('creates a folder and returns it with an id', async () => {
    const folder = await repo.create({ topicId: 't1', profileId: 'p1', name: 'My Folder' });
    expect(folder.id).toBeTruthy();
    expect(folder.name).toBe('My Folder');
    expect(folder.topicId).toBe('t1');
    expect(folder.profileId).toBe('p1');
  });

  it('retrieves a folder by id', async () => {
    const created = await repo.create({ topicId: 't1', profileId: 'p1', name: 'Retrieval Test' });
    const found = await repo.getById(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Retrieval Test');
  });

  it('returns null for an unknown id', async () => {
    const result = await repo.getById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('lists folders by topic', async () => {
    await repo.create({ topicId: 't1', profileId: 'p1', name: 'Alpha' });
    await repo.create({ topicId: 't1', profileId: 'p1', name: 'Beta' });
    const folders = await repo.getByTopicId('t1');
    expect(folders.length).toBe(2);
    expect(folders.map((f: { name: string }) => f.name)).toContain('Alpha');
    expect(folders.map((f: { name: string }) => f.name)).toContain('Beta');
  });

  it('lists all folders for a profile (new getByProfileId)', async () => {
    await repo.create({ topicId: 't1', profileId: 'p1', name: 'Gamma' });
    await repo.create({ topicId: 't1', profileId: 'p1', name: 'Delta' });
    const folders = await repo.getByProfileId('p1');
    expect(folders.length).toBe(2);
  });

  it('returns empty array for unknown profile in getByProfileId', async () => {
    const folders = await repo.getByProfileId('unknown-profile');
    expect(folders).toEqual([]);
  });

  it('updates a folder name', async () => {
    const folder = await repo.create({ topicId: 't1', profileId: 'p1', name: 'Old Name' });
    await repo.update(folder.id, { name: 'New Name' });
    const updated = await repo.getById(folder.id);
    expect(updated!.name).toBe('New Name');
  });

  it('deletes a folder', async () => {
    const folder = await repo.create({ topicId: 't1', profileId: 'p1', name: 'ToDelete' });
    await repo.delete(folder.id);
    const found = await repo.getById(folder.id);
    expect(found).toBeNull();
  });
});
