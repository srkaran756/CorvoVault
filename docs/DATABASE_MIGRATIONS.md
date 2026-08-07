# Database Migrations

The migration runner is `electron/db/migrate.ts`. The SQL files in `electron/db/migrations/` are reference documentation and are not the runtime source for packaged builds.

## Current state

The runtime migration list currently reaches version 16. Reference SQL files should remain synchronized with the corresponding entries in `migrate.ts`.

## Adding a migration

1. Add a new versioned entry to `MIGRATIONS`.
2. Use defensive SQL where reruns or existing columns are possible.
3. Add the matching reference `.sql` file.
4. Test startup against a clean database and a database at the previous version.
5. Never edit the SQL of an already-applied migration.
