/*
  Migration 005_add_document_chunks.sql
  Adds core document_chunks table with metadata needed for the RAG pipeline.
*/
CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id      TEXT PRIMARY KEY,
  material_id   TEXT NOT NULL,
  page          INTEGER NOT NULL,
  section       TEXT,
  chunk_type    TEXT NOT NULL,            -- heading | paragraph | equation | caption | list_item
  is_toc        BOOLEAN DEFAULT FALSE,   -- true for TOC entries
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
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_document_chunks_material ON document_chunks(material_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_chapter ON document_chunks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_page ON document_chunks(page);
CREATE INDEX IF NOT EXISTS idx_document_chunks_type ON document_chunks(chunk_type);
