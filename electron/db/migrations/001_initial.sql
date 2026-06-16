PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- TABLE 1
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  avatar_path TEXT,
  created_at  INTEGER NOT NULL
);

-- TABLE 2
CREATE TABLE IF NOT EXISTS topics (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- TABLE 3
CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (topic_id)
    REFERENCES topics(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- TABLE 4 — Core vault table
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
  FOREIGN KEY (folder_id)
    REFERENCES folders(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- TABLE 5
CREATE TABLE IF NOT EXISTS material_notes (
  id          TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (material_id)
    REFERENCES materials(id) ON DELETE CASCADE
);

-- TABLE 6
CREATE TABLE IF NOT EXISTS video_progress (
  material_id  TEXT PRIMARY KEY,
  current_time REAL NOT NULL DEFAULT 0,
  duration     REAL,
  last_watched INTEGER NOT NULL,
  FOREIGN KEY (material_id)
    REFERENCES materials(id) ON DELETE CASCADE
);

-- TABLE 7
CREATE TABLE IF NOT EXISTS bookmarks (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  url        TEXT NOT NULL,
  title      TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- TABLE 8 — Phone data + desktop usage
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
  FOREIGN KEY (profile_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- TABLE 9
CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  action     TEXT NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- TABLE 10 — Full text search (virtual)
CREATE VIRTUAL TABLE IF NOT EXISTS materials_fts
  USING fts5(
    title,
    url,
    content='materials',
    content_rowid='rowid'
  );

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_materials_folder
  ON materials(folder_id);

CREATE INDEX IF NOT EXISTS idx_materials_profile_status
  ON materials(profile_id, storage_status);

CREATE INDEX IF NOT EXISTS idx_materials_trashed
  ON materials(profile_id, trashed_at)
  WHERE trashed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_profile_date
  ON daily_usage(profile_id, date);

CREATE INDEX IF NOT EXISTS idx_usage_app
  ON daily_usage(profile_id, app_name);

CREATE INDEX IF NOT EXISTS idx_activity_date
  ON activity_log(profile_id, created_at);

-- FTS TRIGGERS
CREATE TRIGGER IF NOT EXISTS materials_fts_insert
  AFTER INSERT ON materials BEGIN
    INSERT INTO materials_fts(rowid, title, url)
    VALUES (new.rowid, new.title, new.url);
  END;

CREATE TRIGGER IF NOT EXISTS materials_fts_update
  AFTER UPDATE ON materials BEGIN
    UPDATE materials_fts
    SET title = new.title, url = new.url
    WHERE rowid = new.rowid;
  END;

CREATE TRIGGER IF NOT EXISTS materials_fts_delete
  AFTER DELETE ON materials BEGIN
    DELETE FROM materials_fts
    WHERE rowid = old.rowid;
  END;
