# DB Migrations — Developer Reference

## Important: How migrations actually run

The migration runner is **`electron/db/migrate.ts`**, not the `.sql` files in this folder.

`migrate.ts` embeds all SQL **inline as TypeScript string literals** because `tsc` does
not copy `.sql` files when it compiles the main process to `dist-electron/`. If the SQL
lived only in `.sql` files, every install from a compiled package would crash with
*"no such table"* errors.

## What these .sql files are for

These files are **documentation only**. They let you read the full database schema
without grepping TypeScript string literals in `migrate.ts`. Keep them in sync with
the inline SQL whenever a new migration is added.

## Migration versions

| Version | File | Description |
|---------|------|-------------|
| 001 | `001_initial.sql` | All core tables, indexes, and FTS triggers |
| 002 | `002_add_trash_path.sql` | Add `trash_path` column to `materials` |
| 003 | `003_profile_config.sql` | Add `profile_settings`, `profile_stats`, `profile_theme` tables |
| 004 | `004_profiles_current.sql` | Add `current` flag column to `profiles` |

## Adding a new migration

1. Add the SQL as a new entry in the `MIGRATIONS` array in `electron/db/migrate.ts`
2. Create a matching `.sql` file here with the same SQL and a `NOTE: DOCUMENTATION ONLY` header
3. The runner will apply the migration automatically on next app start
