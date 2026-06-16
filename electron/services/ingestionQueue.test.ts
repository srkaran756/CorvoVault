import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { IngestionQueue } from './ingestionQueue';
import { ProfessorService } from './professorService';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('mock-path'),
  },
  BrowserWindow: class {
    isDestroyed() { return false; }
    webContents = {
      send: vi.fn(),
    };
  },
}));

// Mock EmbeddingService to avoid loading Transformers model in test
vi.mock('./embeddingService', () => {
  return {
    EmbeddingService: class {
      embedBatch = vi.fn().mockResolvedValue([new Float32Array(384)]);
    },
  };
});

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  
  // Create tables needed for IngestionQueue
  db.exec(`
    CREATE TABLE IF NOT EXISTS concept_index (
      material_id   TEXT PRIMARY KEY,
      index_json    TEXT NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'not_started',
      error_message TEXT,
      total_chunks  INTEGER DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingestion_queue (
      queue_id      TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      local_path    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'waiting',
      priority      INTEGER NOT NULL DEFAULT 0,
      attempts      INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      queued_at     INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS document_chunks (
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
      raw_text      TEXT,
      parent_summary_id TEXT
    );
  `);
  return db;
}

describe('IngestionQueue', () => {
  let db: Database.Database;
  let professorService: ProfessorService;
  let queue: IngestionQueue;

  beforeEach(() => {
    db = createTestDb();
    professorService = new ProfessorService(db);
    queue = new IngestionQueue(db, professorService, () => null);
    vi.spyOn(queue as any, 'runIngestion').mockResolvedValue(undefined);
  });

  it('enqueues a job correctly and sets status to queued', () => {
    queue.enqueue('mat1', 'path/to/doc.pdf', 1);

    const job = db.prepare('SELECT * FROM ingestion_queue WHERE material_id = ?').get('mat1') as any;
    expect(job).toBeDefined();
    expect(job.status).toBe('waiting');
    expect(job.local_path).toBe('path/to/doc.pdf');
    expect(job.priority).toBe(1);

    const indexRow = db.prepare('SELECT * FROM concept_index WHERE material_id = ?').get('mat1') as any;
    expect(indexRow).toBeDefined();
    expect(indexRow.status).toBe('queued');
  });
});
