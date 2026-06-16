-- Migration 002: Add trash_path column to materials table
ALTER TABLE materials ADD COLUMN trash_path TEXT;
