import Database from 'better-sqlite3';

// SQL migrations embedded inline so they survive TypeScript compilation
// (tsc does not copy .sql files — embedding prevents the "no such table" crash)
const MIGRATIONS: Array<{ version: number; filename: string; sql: string }> = [
  {
    version: 1,
    filename: '001_initial.sql',
    sql: `
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  avatar_path TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (topic_id)   REFERENCES topics(id)   ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS materials (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT NOT NULL,
  profile_id     TEXT NOT NULL,
  box_type       TEXT NOT NULL,
  title          TEXT,
  url            TEXT,
  local_path     TEXT,
  storage_status TEXT NOT NULL DEFAULT 'active',
  file_hash      TEXT,
  file_size      INTEGER,
  trashed_at     INTEGER,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (folder_id)  REFERENCES folders(id)  ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS material_notes (
  id          TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_progress (
  material_id  TEXT PRIMARY KEY,
  current_time REAL NOT NULL DEFAULT 0,
  duration     REAL,
  last_watched INTEGER NOT NULL,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  url        TEXT NOT NULL,
  title      TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_usage (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL,
  date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  app_name     TEXT NOT NULL,
  app_package  TEXT,
  app_category TEXT,
  minutes      INTEGER NOT NULL,
  source       TEXT NOT NULL DEFAULT 'mobile',
  device_id    TEXT,
  received_at  INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  action     TEXT NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS materials_fts
  USING fts5(
    title,
    url,
    content='materials',
    content_rowid='rowid'
  );

CREATE INDEX IF NOT EXISTS idx_materials_folder        ON materials(folder_id);
CREATE INDEX IF NOT EXISTS idx_materials_profile_status ON materials(profile_id, storage_status);
CREATE INDEX IF NOT EXISTS idx_materials_trashed        ON materials(profile_id, trashed_at) WHERE trashed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_profile_date       ON daily_usage(profile_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_app                ON daily_usage(profile_id, app_name);
CREATE INDEX IF NOT EXISTS idx_activity_date            ON activity_log(profile_id, created_at);

CREATE TRIGGER IF NOT EXISTS materials_fts_insert
  AFTER INSERT ON materials BEGIN
    INSERT INTO materials_fts(rowid, title, url) VALUES (new.rowid, new.title, new.url);
  END;

CREATE TRIGGER IF NOT EXISTS materials_fts_update
  AFTER UPDATE ON materials BEGIN
    UPDATE materials_fts SET title = new.title, url = new.url WHERE rowid = new.rowid;
  END;

CREATE TRIGGER IF NOT EXISTS materials_fts_delete
  AFTER DELETE ON materials BEGIN
    DELETE FROM materials_fts WHERE rowid = old.rowid;
  END;
    `
  },
  {
    version: 2,
    filename: '002_add_trash_path.sql',
    sql: `ALTER TABLE materials ADD COLUMN trash_path TEXT;`
  },
  {
    version: 3,
    filename: '003_profile_config.sql',
    sql: `
CREATE TABLE IF NOT EXISTS profile_settings (
  profile_id  TEXT PRIMARY KEY,
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_stats (
  profile_id  TEXT PRIMARY KEY,
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_theme (
  profile_id      TEXT PRIMARY KEY,
  theme_data      TEXT NOT NULL DEFAULT '{}',
  overrides_data  TEXT NOT NULL DEFAULT '{}',
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
    `
  },
  {
    version: 4,
    filename: '004_profiles_current.sql',
    sql: `ALTER TABLE profiles ADD COLUMN current INTEGER NOT NULL DEFAULT 0;`
  },
  {
    version: 5,
    filename: '005_professor_document_map.sql',
    sql: `
    -- One row per semantic chunk from a PDF page
    CREATE TABLE IF NOT EXISTS document_chunks (
      chunk_id      TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      page          INTEGER NOT NULL,
      section       TEXT,
      chunk_type    TEXT NOT NULL,       -- 'heading'|'paragraph'|'equation'|'caption'|'list_item'
      text          TEXT NOT NULL,
      -- Normalized bbox [0..1] relative to page dimensions
      bbox_x        REAL,
      bbox_y        REAL,
      bbox_w        REAL,
      bbox_h        REAL,
      -- Float32Array serialized as BLOB — 384 dimensions for all-MiniLM-L6
      embedding     BLOB,
      chunk_order   INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );

    -- One row per document: concept map + ingestion status
    CREATE TABLE IF NOT EXISTS concept_index (
      material_id   TEXT PRIMARY KEY,
      index_json    TEXT NOT NULL DEFAULT '{}',
      -- 'not_started'|'queued'|'processing'|'ready'|'failed'
      status        TEXT NOT NULL DEFAULT 'not_started',
      error_message TEXT,
      total_chunks  INTEGER DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );

    -- Per-material professor session (survives app restarts)
    CREATE TABLE IF NOT EXISTS professor_sessions (
      session_id          TEXT PRIMARY KEY,
      material_id         TEXT NOT NULL,
      conversation_json   TEXT NOT NULL DEFAULT '[]',
      student_model_json  TEXT NOT NULL DEFAULT '{}',
      agenda_json         TEXT NOT NULL DEFAULT '[]',
      board_state_json    TEXT NOT NULL DEFAULT 'null',
      last_page           INTEGER NOT NULL DEFAULT 1,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );

    -- Persistent ingestion queue (survives app restarts)
    -- If the app closes mid-ingestion, the queue resumes next launch
    CREATE TABLE IF NOT EXISTS ingestion_queue (
      queue_id      TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      local_path    TEXT NOT NULL,
      -- 'waiting'|'processing'|'done'|'failed'
      status        TEXT NOT NULL DEFAULT 'waiting',
      priority      INTEGER NOT NULL DEFAULT 0,   -- higher = sooner
      attempts      INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      queued_at     INTEGER NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_material   ON document_chunks(material_id, chunk_order);
    CREATE INDEX IF NOT EXISTS idx_chunks_page       ON document_chunks(material_id, page);
    CREATE INDEX IF NOT EXISTS idx_queue_status      ON ingestion_queue(status, priority DESC, queued_at);
    `
  },
  {
    version: 6,
    filename: '006_vec_infrastructure.sql',
    sql: `
    -- Stores key-value flags for persistent runtime state
    CREATE TABLE IF NOT EXISTS db_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Maps the vec0 integer rowid back to a chunk_id UUID.
    CREATE TABLE IF NOT EXISTS vec_chunk_map (
      rowid       INTEGER PRIMARY KEY,
      chunk_id    TEXT    NOT NULL UNIQUE,
      material_id TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vec_map_material ON vec_chunk_map(material_id);
    `
  },
  {
    version: 7,
    filename: '007_vec_chunk_map_fk.sql',
    sql: `
    -- Fix B-01: Ghost Vectors
    -- vec_chunk_map currently has no FK. When a material is deleted,
    -- its rows stay forever, permanently degrading KNN performance.
    -- SQLite doesn't support ADD CONSTRAINT, so we rebuild the table.

    CREATE TABLE IF NOT EXISTS vec_chunk_map_v3 (
      rowid       INTEGER PRIMARY KEY,
      chunk_id    TEXT    NOT NULL UNIQUE,
      material_id TEXT    NOT NULL,
      FOREIGN KEY (chunk_id)
        REFERENCES document_chunks(chunk_id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO vec_chunk_map_v3
      SELECT rowid, chunk_id, material_id FROM vec_chunk_map;

    DROP TABLE IF EXISTS vec_chunk_map;

    ALTER TABLE vec_chunk_map_v3 RENAME TO vec_chunk_map;

    CREATE INDEX IF NOT EXISTS idx_vec_map_material ON vec_chunk_map(material_id);
    `
  },
  {
    version: 8,
    filename: '008_structural_columns.sql',
    sql: `
    -- Fix B-02/B-06: Add structural metadata columns to document_chunks.
    -- chapter_id: normalized slug like "chapter_2" or "introduction"
    -- raw_text: verbatim bytes from pdfjs getTextContent() for LLM prompts
    -- parent_summary_id: future parent-child chunking support

    ALTER TABLE document_chunks ADD COLUMN chapter_id TEXT;
    ALTER TABLE document_chunks ADD COLUMN raw_text TEXT;
    ALTER TABLE document_chunks ADD COLUMN parent_summary_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_chunks_chapter
      ON document_chunks(material_id, chapter_id);
    `
  },
  {
    version: 9,
    filename: '009_annotations_table.sql',
    sql: `
    -- Fix B-07: Move annotations from localStorage to SQLite.
    -- Prevents data loss when browser cache is cleared.

    CREATE TABLE IF NOT EXISTS annotations (
      annotation_id TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      chunk_id      TEXT,
      page          INTEGER NOT NULL,
      type          TEXT NOT NULL,
      target_text   TEXT,
      color         TEXT NOT NULL DEFAULT 'orange',
      callout       TEXT,
      bbox_x        REAL,
      bbox_y        REAL,
      bbox_w        REAL,
      bbox_h        REAL,
      stroke_data   TEXT,
      source        TEXT NOT NULL DEFAULT 'user',
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
      FOREIGN KEY (chunk_id) REFERENCES document_chunks(chunk_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_material
      ON annotations(material_id, page);

    -- Also add pdf_bookmarks table for localStorage bookmark migration
    CREATE TABLE IF NOT EXISTS pdf_bookmarks (
      bookmark_id   TEXT PRIMARY KEY,
      material_id   TEXT NOT NULL,
      page          INTEGER NOT NULL,
      label         TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bookmarks_material
      ON pdf_bookmarks(material_id);
    `
  },
  {
    version: 10,
    filename: '010_is_toc_column.sql',
    sql: `
    -- Fix TOC Retrieval Pollution (Problems 1-4):
    -- Add is_toc flag so TOC entries can be excluded from retrieval.
    -- BM25 used to score TOC heading lines highly for chapter queries
    -- because they contain chapter numbers and keywords with no content.
    -- Filtering is_toc = 0 removes this contamination.
    ALTER TABLE document_chunks ADD COLUMN is_toc INTEGER NOT NULL DEFAULT 0;

    -- Index for fast filtering
    CREATE INDEX IF NOT EXISTS idx_chunks_is_toc
      ON document_chunks(material_id, is_toc);
    `
  }
];

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some(row => row.name === columnName);
}

export function runMigrations(db: Database.Database): void {
  // Apply connection-level PRAGMAs (must run outside any transaction)
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Create migrations tracking table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      filename   TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `).run();

  for (const migration of MIGRATIONS) {
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
    if (applied) continue;

    console.log(`[DB] Applying migration: ${migration.filename}`);

    db.transaction(() => {
      if (migration.version === 2 && hasColumn(db, 'materials', 'trash_path')) {
        console.log('[DB] materials.trash_path already exists; recording migration.');
      } else if (migration.version === 4 && hasColumn(db, 'profiles', 'current')) {
        console.log('[DB] profiles.current already exists; recording migration.');
      } else if (migration.version === 8 && hasColumn(db, 'document_chunks', 'chapter_id')) {
        console.log('[DB] document_chunks.chapter_id already exists; recording migration.');
      } else if (migration.version === 10 && hasColumn(db, 'document_chunks', 'is_toc')) {
        console.log('[DB] document_chunks.is_toc already exists; recording migration.');
      } else {
        db.exec(migration.sql);
      }
      db.prepare('INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.filename,
        Date.now()
      );
    })();

    console.log(`[DB] Migration ${migration.filename} applied successfully.`);
  }
}
