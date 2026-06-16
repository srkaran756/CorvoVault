import Database from 'better-sqlite3';
import { EmbeddingService } from '../../services/embeddingService';
import { VectorRepository, VectorChunk, KnnResult, EMBEDDING_DIM } from '../interfaces/VectorRepository';

export class SqliteVectorRepository implements VectorRepository {
  private _isAvailable: boolean = false;

  constructor(private db: Database.Database) {}

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  initialize(): void {
    try {
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(this.db);
      
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
          embedding float[384]
        )
      `);
      this._isAvailable = true;
      console.log('[VectorRepository] sqlite-vec loaded. vec_chunks table ready.');
    } catch (err) {
      this._isAvailable = false;
      console.warn('[VectorRepository] sqlite-vec unavailable; using in-memory fallback.', err);
      return;
    }

    try {
      const statusRow = this.db.prepare(
        `SELECT value FROM db_meta WHERE key = 'vec_backfill_status'`
      ).get() as { value: string } | undefined;

      const extRow = this.db.prepare(
        `SELECT value FROM db_meta WHERE key = 'vec_backfill_extension_available'`
      ).get() as { value: string } | undefined;

      const backfillComplete = statusRow?.value === 'complete';
      const backfillHadExtension = extRow?.value === 'true';

      if (backfillComplete && backfillHadExtension) {
        console.log('[VectorRepository] Backfill already complete. Skipping.');
        return;
      }

      console.log('[VectorRepository] Running one-time vec_chunks backfill...');
      this.setMeta('vec_backfill_status', 'in_progress');
      this.setMeta('vec_backfill_extension_available', 'false');

      this.runBackfill();

      this.setMeta('vec_backfill_status', 'complete');
      this.setMeta('vec_backfill_extension_available', 'true');
      console.log('[VectorRepository] Backfill complete.');
    } catch (err) {
      console.error('[VectorRepository] Failed to run backfill initialization:', err);
    }
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO db_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, Date.now());
  }

  private runBackfill(): void {
    this.db.transaction(() => {
      // Clear maps and virtual tables to ensure clean backfill
      this.db.prepare('DELETE FROM vec_chunk_map').run();
      this.db.prepare('DELETE FROM vec_chunks').run();

      // Read all rows from document_chunks that have embeddings
      const rows = this.db.prepare(`
        SELECT chunk_id, material_id, embedding 
        FROM document_chunks 
        WHERE embedding IS NOT NULL
      `).all() as Array<{ chunk_id: string; material_id: string; embedding: Buffer }>;

      console.log(`[VectorRepository] Backfilling ${rows.length} chunks...`);
      
      const groups = new Map<string, VectorChunk[]>();
      for (const row of rows) {
        let list = groups.get(row.material_id);
        if (!list) {
          list = [];
          groups.set(row.material_id, list);
        }
        list.push({
          chunkId: row.chunk_id,
          embedding: EmbeddingService.fromBuffer(row.embedding)
        });
      }

      for (const [materialId, chunks] of groups.entries()) {
        this.insertChunksInternal(materialId, chunks);
      }
    })();
  }

  insertChunks(materialId: string, chunks: VectorChunk[]): void {
    if (!this._isAvailable) {
      throw new Error('[VectorRepository] Cannot insert: sqlite-vec is not available');
    }
    this.db.transaction(() => {
      this.insertChunksInternal(materialId, chunks);
    })();
  }

  private insertChunksInternal(materialId: string, chunks: VectorChunk[]): void {
    const insertVecStmt = this.db.prepare(`
      INSERT INTO vec_chunks (embedding) VALUES (?)
    `);
    const insertMapStmt = this.db.prepare(`
      INSERT INTO vec_chunk_map (rowid, chunk_id, material_id) VALUES (?, ?, ?)
    `);

    for (const chunk of chunks) {
      if (chunk.embedding.length !== EMBEDDING_DIM) {
        throw new TypeError(
          `[VectorRepository] Dimension mismatch: expected ${EMBEDDING_DIM}, ` +
          `got ${chunk.embedding.length}. Is EmbeddingService still using all-MiniLM-L6-v2?`
        );
      }

      const blob = EmbeddingService.toBuffer(chunk.embedding);
      const res = insertVecStmt.run(blob);
      const rowid = res.lastInsertRowid;

      insertMapStmt.run(rowid, chunk.chunkId, materialId);
    }
  }

  deleteByMaterial(materialId: string): void {
    if (!this._isAvailable) return;

    this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT rowid FROM vec_chunk_map WHERE material_id = ?
      `).all(materialId) as Array<{ rowid: number }>;

      if (rows.length === 0) return;

      const deleteVecStmt = this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?');
      for (const row of rows) {
        deleteVecStmt.run(row.rowid);
      }

      this.db.prepare('DELETE FROM vec_chunk_map WHERE material_id = ?').run(materialId);
    })();
  }

  knnSearch(materialId: string, queryEmbedding: Float32Array, k: number): KnnResult[] {
    if (!this._isAvailable) {
      return [];
    }

    if (queryEmbedding.length !== EMBEDDING_DIM) {
      throw new TypeError(
        `[VectorRepository] KNN Query Dimension mismatch: expected ${EMBEDDING_DIM}, ` +
        `got ${queryEmbedding.length}.`
      );
    }

    const blob = EmbeddingService.toBuffer(queryEmbedding);

    const rows = this.db.prepare(`
      SELECT m.chunk_id as chunkId, vec_distance_cosine(k.embedding, ?) as distance
      FROM vec_chunks k
      JOIN vec_chunk_map m ON m.rowid = k.rowid
      WHERE m.material_id = ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(blob, materialId, k) as KnnResult[];

    return rows;
  }

  knnSearchInChapter(materialId: string, queryEmbedding: Float32Array, chapterIds: string[], k: number): KnnResult[] {
    if (!this._isAvailable || chapterIds.length === 0) {
      return [];
    }

    if (queryEmbedding.length !== EMBEDDING_DIM) {
      throw new TypeError(
        `[VectorRepository] KNN Query Dimension mismatch: expected ${EMBEDDING_DIM}, ` +
        `got ${queryEmbedding.length}.`
      );
    }

    const blob = EmbeddingService.toBuffer(queryEmbedding);
    const placeholders = chapterIds.map(() => '?').join(',');

    const rows = this.db.prepare(`
      SELECT m.chunk_id as chunkId, vec_distance_cosine(k.embedding, ?) as distance
      FROM vec_chunks k
      JOIN vec_chunk_map m ON m.rowid = k.rowid
      JOIN document_chunks c ON c.chunk_id = m.chunk_id
      WHERE m.material_id = ?
        AND c.chapter_id IN (${placeholders})
      ORDER BY distance ASC
      LIMIT ?
    `).all(blob, materialId, ...chapterIds, k) as KnnResult[];

    return rows;
  }

  knnSearchOnPage(materialId: string, queryEmbedding: Float32Array, page: number, k: number): KnnResult[] {
    if (!this._isAvailable) {
      return [];
    }

    if (queryEmbedding.length !== EMBEDDING_DIM) {
      throw new TypeError(
        `[VectorRepository] KNN Query Dimension mismatch: expected ${EMBEDDING_DIM}, ` +
        `got ${queryEmbedding.length}.`
      );
    }

    const blob = EmbeddingService.toBuffer(queryEmbedding);

    const rows = this.db.prepare(`
      SELECT m.chunk_id as chunkId, vec_distance_cosine(k.embedding, ?) as distance
      FROM vec_chunks k
      JOIN vec_chunk_map m ON m.rowid = k.rowid
      JOIN document_chunks c ON c.chunk_id = m.chunk_id
      WHERE m.material_id = ?
        AND c.page = ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(blob, materialId, page, k) as KnnResult[];

    return rows;
  }
}
