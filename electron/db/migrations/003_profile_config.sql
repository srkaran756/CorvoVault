-- Migration 003: Per-profile settings, stats, and theme storage
-- NOTE: This file is DOCUMENTATION ONLY.
-- The migration runner in electron/db/migrate.ts embeds all SQL inline so it
-- survives TypeScript compilation (tsc does not copy .sql files to dist-electron/).
-- This file exists so developers can read the schema without grepping TypeScript.

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
