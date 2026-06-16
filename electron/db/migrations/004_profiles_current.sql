-- Migration 004: Add current-profile flag to profiles table
-- NOTE: This file is DOCUMENTATION ONLY.
-- The migration runner in electron/db/migrate.ts embeds all SQL inline so it
-- survives TypeScript compilation (tsc does not copy .sql files to dist-electron/).
-- This file exists so developers can read the schema without grepping TypeScript.

ALTER TABLE profiles ADD COLUMN current INTEGER NOT NULL DEFAULT 0;
