import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProfessorService } from './professorService';

// Mock EmbeddingService
vi.mock('./embeddingService', () => {
  return {
    EmbeddingService: class {
      embedBatch = vi.fn().mockResolvedValue([new Float32Array(384)]);
      static fromBuffer(buf: Buffer) {
        return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      }
      static toBuffer(arr: Float32Array) {
        return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
      }
      static cosineSimilarity() {
        return 0.9;
      }
    },
  };
});

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

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

    CREATE TABLE IF NOT EXISTS document_chunks (
      chunk_id      TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      page          INTEGER NOT NULL,
      section       TEXT,
      chunk_type    TEXT NOT NULL,
      is_toc        BOOLEAN DEFAULT FALSE,
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
  `);
  return db;
}

describe('ProfessorService classifyAndRetrieve', () => {
  let db: Database.Database;
  let service: ProfessorService;

  beforeEach(() => {
    db = createTestDb();
    service = new ProfessorService(db);

    // Seed test data
    const embedding = new Float32Array(384);
    embedding[0] = 1.0;
    const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    db.prepare(`
      INSERT INTO document_chunks (
        chunk_id, material_id, page, section, chunk_type, text, chunk_order, created_at, chapter_id
      ) VALUES
        ('c1', 'mat1', 1, 'Introduction', 'heading', 'Chapter 1: Intro to Biology', 0, 100, 'chapter_1'),
        ('c2', 'mat1', 1, 'Introduction', 'paragraph', 'Biology is the study of life.', 1, 101, 'chapter_1'),
        ('c3', 'mat1', 5, 'Cell Structure', 'heading', 'Chapter 2: Cells', 2, 102, 'chapter_2'),
        ('c4', 'mat1', 5, 'Cell Structure', 'paragraph', 'Cells are the basic units of life.', 3, 103, 'chapter_2')
    `).run();

    // Populate concept map
    service.storeConceptIndex('mat1', {
      topics: [
        { name: 'Chapter 1: Intro to Biology', page: 1, endPage: 4, pages: [1, 2, 3, 4] },
        { name: 'Chapter 2: Cells', page: 5, endPage: 8, pages: [5, 6, 7, 8] }
      ]
    }, 'ready');
  });

  it('classifies and retrieves LOCAL page queries correctly', async () => {
    const res = await service.classifyAndRetrieve('mat1', 1, 10, 'what does this page say?', []);
    expect(res.intent).toBe('PAGE_CONTEXT');
    expect(res.relevantChunks.length).toBeGreaterThan(0);
    // Should only contain page 1 chunks
    res.relevantChunks.forEach(c => {
      expect(c.page).toBe(1);
    });
  });

  it('classifies and retrieves CHAPTER references correctly', async () => {
    const res = await service.classifyAndRetrieve('mat1', 1, 10, 'explain chapter 2', []);
    expect(res.intent).toBe('CHAPTER_SUMMARY');
    expect(res.relevantChunks.length).toBeGreaterThan(0);
    // Should only contain chapter_2 or page 5 chunks
    res.relevantChunks.forEach(c => {
      expect(c.page).toBe(5);
    });
  });

  it('classifies and retrieves GLOBAL summary queries correctly', async () => {
    const res = await service.classifyAndRetrieve('mat1', 1, 10, 'summarize the entire document', []);
    expect(res.intent).toBe('CHAPTER_SUMMARY');
    expect(res.relevantChunks.length).toBe(2);
    // Should return only heading chunks
    res.relevantChunks.forEach(c => {
      expect(c.chunk_type).toBe('heading');
    });
  });

  it('resolves relative pronouns in query rewriting', async () => {
    const history = [
      { role: 'user', content: 'What is biology?' },
      { role: 'assistant', content: 'Biology is the study of living organisms and cells.' }
    ];
    // Asking "explain it" should trigger rewriting to include cells/organisms
    const res = await service.classifyAndRetrieve('mat1', 1, 10, 'explain it more', history);
    // The query should be rewritten, resulting in classification or factual search
    expect(res.intent).toBe('FACT_LOOKUP');
  });
});
