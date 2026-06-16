import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteVectorRepository } from './SqliteVectorRepository';
import { EmbeddingService } from '../../services/embeddingService';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  
  // Create tables mimicking migration v5 and v6
  db.exec(`
    CREATE TABLE document_chunks (
      chunk_id      TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      page          INTEGER NOT NULL,
      section       TEXT,
      chunk_type    TEXT NOT NULL,
      text          TEXT NOT NULL,
      bbox_x        REAL,
      bbox_y        REAL,
      bbox_w        REAL,
      bbox_h        REAL,
      embedding     BLOB,
      chunk_order   INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      chapter_id    TEXT,
      raw_text      TEXT
    );

    CREATE TABLE db_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE vec_chunk_map (
      rowid       INTEGER PRIMARY KEY,
      chunk_id    TEXT    NOT NULL UNIQUE,
      material_id TEXT    NOT NULL
    );
  `);

  return db;
}

describe('SqliteVectorRepository', () => {
  let db: Database.Database;
  let repo: SqliteVectorRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new SqliteVectorRepository(db);
    repo.initialize();
  });

  it('initializes and is available', () => {
    expect(repo.isAvailable).toBe(true);
  });

  it('inserts and searches vector chunks', () => {
    const embedding1 = new Float32Array(384);
    embedding1[0] = 0.5;
    embedding1[1] = 0.5;

    const embedding2 = new Float32Array(384);
    embedding2[0] = 0.1;
    embedding2[1] = 0.9;

    repo.insertChunks('material-1', [
      { chunkId: 'chunk-1', embedding: embedding1 },
      { chunkId: 'chunk-2', embedding: embedding2 }
    ]);

    const query = new Float32Array(384);
    query[0] = 0.49;
    query[1] = 0.51;

    const results = repo.knnSearch('material-1', query, 2);
    expect(results.length).toBe(2);
    expect(results[0].chunkId).toBe('chunk-1');
  });

  it('asserts vector dimension on insert', () => {
    const badEmbedding = new Float32Array(100); // wrong dim
    expect(() => {
      repo.insertChunks('material-1', [
        { chunkId: 'chunk-bad', embedding: badEmbedding }
      ]);
    }).toThrow(TypeError);
  });

  it('deletes chunks by material', () => {
    const embedding = new Float32Array(384);
    embedding[0] = 1.0;

    repo.insertChunks('material-1', [
      { chunkId: 'chunk-1', embedding }
    ]);

    let results = repo.knnSearch('material-1', embedding, 1);
    expect(results.length).toBe(1);

    repo.deleteByMaterial('material-1');

    results = repo.knnSearch('material-1', embedding, 1);
    expect(results.length).toBe(0);

    // Verify map is clean
    const count = db.prepare('SELECT COUNT(*) as count FROM vec_chunk_map').get() as { count: number };
    expect(count.count).toBe(0);
  });

  it('runs backfill automatically if db_meta is empty/incomplete', () => {
    // Drop repo and db to setup pre-existing data
    const newDb = createTestDb();
    
    // Insert a chunk into document_chunks with embedding
    const embedding = new Float32Array(384);
    embedding[0] = 0.7;
    embedding[1] = 0.7;
    const blob = EmbeddingService.toBuffer(embedding);

    newDb.prepare(`
      INSERT INTO document_chunks (
        chunk_id, material_id, page, chunk_type, text, embedding, chunk_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('chunk-backfilled', 'material-backfill', 1, 'paragraph', 'Hello', blob, 0, Date.now());

    // Initialize new repo
    const newRepo = new SqliteVectorRepository(newDb);
    newRepo.initialize();

    // Verify it backfilled the existing chunk
    const results = newRepo.knnSearch('material-backfill', embedding, 1);
    expect(results.length).toBe(1);
    expect(results[0].chunkId).toBe('chunk-backfilled');

    // Verify db_meta contains the completion markers
    const status = newDb.prepare("SELECT value FROM db_meta WHERE key = 'vec_backfill_status'").get() as { value: string };
    const ext = newDb.prepare("SELECT value FROM db_meta WHERE key = 'vec_backfill_extension_available'").get() as { value: string };
    expect(status.value).toBe('complete');
    expect(ext.value).toBe('true');
  });

  it('filters KNN searches by chapter using knnSearchInChapter', () => {
    const embedding = new Float32Array(384);
    embedding[0] = 0.8;
    const blob = EmbeddingService.toBuffer(embedding);

    // Insert mock chunks into document_chunks
    db.prepare(`
      INSERT INTO document_chunks (
        chunk_id, material_id, page, chunk_type, text, embedding, chunk_order, created_at, chapter_id
      ) VALUES
        ('c-chap1', 'mat-2', 1, 'paragraph', 'Intro', ?, 0, ?, 'chapter_1'),
        ('c-chap2', 'mat-2', 5, 'paragraph', 'Body', ?, 1, ?, 'chapter_2')
    `).run(blob, Date.now(), blob, Date.now());

    // Insert maps to vec_chunk_map and virtual table
    repo.insertChunks('mat-2', [
      { chunkId: 'c-chap1', embedding },
      { chunkId: 'c-chap2', embedding }
    ]);

    // Search in chapter_1
    const results1 = repo.knnSearchInChapter('mat-2', embedding, ['chapter_1'], 2);
    expect(results1.length).toBe(1);
    expect(results1[0].chunkId).toBe('c-chap1');

    // Search in chapter_2
    const results2 = repo.knnSearchInChapter('mat-2', embedding, ['chapter_2'], 2);
    expect(results2.length).toBe(1);
    expect(results2[0].chunkId).toBe('c-chap2');
  });

  it('filters KNN searches by page using knnSearchOnPage', () => {
    const embedding = new Float32Array(384);
    embedding[0] = 0.9;
    const blob = EmbeddingService.toBuffer(embedding);

    db.prepare(`
      INSERT INTO document_chunks (
        chunk_id, material_id, page, chunk_type, text, embedding, chunk_order, created_at, chapter_id
      ) VALUES
        ('c-page1', 'mat-3', 1, 'paragraph', 'P1', ?, 0, ?, 'intro'),
        ('c-page2', 'mat-3', 2, 'paragraph', 'P2', ?, 1, ?, 'body')
    `).run(blob, Date.now(), blob, Date.now());

    repo.insertChunks('mat-3', [
      { chunkId: 'c-page1', embedding },
      { chunkId: 'c-page2', embedding }
    ]);

    const resultsP1 = repo.knnSearchOnPage('mat-3', embedding, 1, 2);
    expect(resultsP1.length).toBe(1);
    expect(resultsP1[0].chunkId).toBe('c-page1');

    const resultsP2 = repo.knnSearchOnPage('mat-3', embedding, 2, 2);
    expect(resultsP2.length).toBe(1);
    expect(resultsP2[0].chunkId).toBe('c-page2');
  });
});
