# ENGINEERING.md

## Section 1: What This Project Is

CorvoVault is a local-first Electron desktop app for collecting study materials into profiles, topics, folders, and materials. Users interact with it through a React UI that can import files, save links and YouTube videos, read PDFs, preview office documents, take notes, browse the web, and ask an AI tutor questions about PDFs. The app stores its core data in a SQLite database under Electron `userData`, with imported files copied into the same user data area.

## Section 2: Tech Stack

| Technology | Version | Role | Notes |
|---|---:|---|---|
| Electron | ^35.2.1 | Desktop shell, main process, preload bridge, webview host | Chosen so the app can use local files, SQLite, native dialogs, webviews, and OS storage. It is central to the current design. |
| React | ^19.0.0 | Renderer UI | Used for the tabbed desktop interface, vault, PDF reader, settings, and browser views. |
| TypeScript | ~5.8.2 | Main and renderer language | Renderer `tsconfig.json` has `allowJs` and `noEmit`; main process compiles through `electron/tsconfig.json`. |
| Vite | ^6.2.0 | Renderer bundler/dev server | `npm run dev` starts only Vite. `npm run electron:dev` starts Vite and Electron together. |
| Tailwind CSS | ^4.1.14 | CSS utility layer | Loaded via `@tailwindcss/vite`; most component styling is inline class names in TSX. |
| better-sqlite3 | ^12.9.0 | Local SQLite access | Synchronous database layer in Electron main. Works well for simple local persistence, but long operations must stay out of hot UI paths. |
| SQLite FTS5 | SQLite bundled with better-sqlite3 | Text search for materials | `materials_fts` indexes material titles and URLs only. |
| sqlite-vec | ^0.1.7 | Vector search for document chunks | Loaded dynamically in `SqliteVectorRepository`. If unavailable, vector search returns empty results. |
| @xenova/transformers | ^2.17.2 | Local embedding generation | Uses `Xenova/all-MiniLM-L6-v2`, quantized, CPU-only, cached in `userData/ai-models`. This avoids a remote embedding API but adds model download/runtime cost. |
| @langchain/textsplitters | ^1.0.1 | Text splitting in ingestion | Used by `electron/services/ingestionQueue.ts` for chunking PDF text. |
| pdfjs-dist | ^4.10.38 | PDF parsing/rendering | Used in both main ingestion and renderer PDF viewing. The renderer also ships copied `public/pdf.min.js` and worker files. |
| pdf-parse | ^2.4.5 | PDF parsing dependency | Present in `package.json`; no direct import was found in app source. |
| @google/genai | ^1.29.0 | Gemini API client | AI responses are routed through `src/lib/ai.ts` and Gemini helpers. Requires user-provided keys. |
| @supabase/supabase-js | ^2.103.0 | Optional settings connection test | Used from settings for Supabase configuration validation. It is not part of the core local storage path. |
| keytar | ^7.9.0 | Legacy/fallback secret storage | `SecretService` now prefers Electron `safeStorage`; keytar remains for fallback and migration. |
| Electron safeStorage | Electron API | Encrypted local secrets and PIN storage | Used for API keys and PIN config where OS encryption is available. Falls back to keytar or plain JSON in some cases. |
| lucide-react | ^0.546.0 | Icons | Used throughout the UI. |
| motion | ^12.23.24 | Animation | Imported as `motion/react` in UI components. |
| recharts | ^3.8.1 | Charts | Used for dashboard/stats UI. |
| fuse.js | ^7.4.2 | Fuzzy search dependency | Present in `package.json`; no direct import was found in app source. |
| archiver | ^7.0.1 | ZIP export | Used in `electron/main.ts` for vault export. |
| check-disk-space | ^3.4.0 | Import guard | Used before copying files into the vault. |
| electron-updater | ^6.8.3 | GitHub release updates | Configured for production builds only. |
| zod | ^4.4.3 | IPC validation | Currently used only for `vault:searchMaterials` arguments. Most IPC handlers still accept `any` or unchecked values. |
| Vitest | ^4.1.6 | Unit tests | Tests cover parts of repositories, shared IPC schemas, activity timer, RAG services, vector repository, and ingestion queue. |
| happy-dom | ^20.9.0 | Renderer test DOM | Used by Vite/Vitest config for renderer tests. |
| @testing-library/react | ^16.3.2 | Hook/component tests | Used by `src/hooks/useActivityTimer.test.ts`. |
| npm | package-lock v3 | Package manager | `package-lock.json` is present. No pnpm/yarn files were found. |

Dead or questionable dependencies:

- `pdf-parse` is listed but no direct app-source import was found.
- `fuse.js` is listed but no direct app-source import was found.
- `autoprefixer` is listed but no PostCSS config was found. Tailwind 4 is wired through the Vite plugin.

## Section 3: Repository Structure

Actual source tree, excluding generated folders such as `node_modules`, `dist`, `dist-electron`, and `release`:

```text
.
|-- electron/
|   |-- application/
|   |-- db/
|   |   `-- migrations/
|   |-- infrastructure/
|   |-- ipcHandlers/
|   |-- mappers/
|   |-- repositories/
|   |   |-- interfaces/
|   |   `-- sqlite/
|   |-- services/
|   |-- utils/
|   |-- main.ts
|   |-- preload.ts
|   `-- ServiceHost.ts
|-- public/
|-- resources/
|   `-- pandoc/
|-- scratch/
|-- scripts/
|-- shared/
|   `-- ipc/
|-- src/
|   |-- components/
|   |   |-- Vault/
|   |   |-- layout/
|   |   `-- tabs/
|   |-- contexts/
|   |-- events/
|   |-- hooks/
|   |-- lib/
|   |   `-- rag/
|   |-- services/
|   |-- App.tsx
|   |-- main.tsx
|   `-- types.ts
|-- package.json
|-- vite.config.ts
|-- vitest.config.ts
|-- tsconfig.json
|-- README.md
|-- TODO.md
`-- .env.example
```

Top-level folders:

- `electron/` contains the Electron main process, preload bridge, database connection and migrations, IPC handlers, repositories, services, and document conversion code.
- `src/` contains the React renderer. It owns the app shell, tab UI, vault screens, browser, PDF viewer, settings, hooks, and client-side AI orchestration.
- `shared/` contains shared IPC envelope and validation code used by both sides.
- `public/` contains renderer assets, icons, and PDF.js files copied for packaged/offline use.
- `resources/pandoc/` contains the bundled Pandoc executable used to convert DOCX/ODT/RTF-like documents to preview PDFs.
- `scripts/` contains helper scripts for PDF.js assets, icon generation, and killing CorvoVault processes.
- `scratch/` contains ad hoc debugging scripts. These are not part of the runtime app.

Representative flow: importing a PDF file.

```text
User selects a file in src/components/Capture.tsx
  -> Capture calls window.electronAPI.openFileDialog()
  -> electron/preload.ts exposes dialog:openFile
  -> electron/main.ts handles dialog:openFile with dialog.showOpenDialog()
  -> Capture calls window.electronAPI.copyFileToLocal(sourcePath)
  -> electron/main.ts handles file:copyToLocal
  -> main checks free disk space, copies the file into app.getPath('userData')/local-files
  -> Capture calls getFileSize/hashFile and addMaterial()
  -> useMaterials.addMaterial() calls ipcService.vault.capture()
  -> src/services/ipcService.ts invokes vault:capture through the generic preload invoke
  -> electron/ipcHandlers/vaultHandlers.ts receives vault:capture
  -> VaultService.capture() delegates to MaterialApplicationService
  -> SqliteMaterialRepository.create() inserts into materials
  -> vaultHandlers queues PDF ingestion through IngestionQueue.enqueue()
  -> IngestionQueue extracts PDF text, chunks it, embeds it, and writes document_chunks/concept_index/vector rows
  -> renderer updates local React state and later receives professor:ingestionProgress events
```

The layering exists, but it is uneven. The vault path has a recognizable renderer -> preload -> IPC handler -> service -> repository -> SQLite flow. Some file operations, updater operations, web search, and ZIP export live directly in `electron/main.ts`. Several handlers accept untyped `any` payloads and call services directly. Only `vault:searchMaterials` currently uses a shared Zod schema and IPC result envelope.

## Section 4: Data Model

The runtime migration source is `electron/db/migrate.ts`. The `.sql` files in `electron/db/migrations/` are reference copies and are not what the packaged app executes. They are currently behind the runtime migrations: the README in that folder lists only versions 001-004, while `migrate.ts` defines versions 001-010.

SQLite database location:

```text
app.getPath('userData')/corvovault.db
```

Connection PRAGMAs:

- `foreign_keys = ON`
- `journal_mode = WAL`
- `synchronous = NORMAL`

Tables and persistent structures:

### `schema_migrations`

| Column | Type | Constraints |
|---|---|---|
| `version` | INTEGER | PRIMARY KEY |
| `filename` | TEXT | NOT NULL |
| `applied_at` | INTEGER | NOT NULL |

Tracks applied migrations.

### `profiles`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `avatar_path` | TEXT | nullable |
| `created_at` | INTEGER | NOT NULL |
| `current` | INTEGER | NOT NULL DEFAULT 0, added by migration 004 |

Stores local user profiles. `current = 1` marks the active profile.

### `topics`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` ON DELETE CASCADE |
| `name` | TEXT | NOT NULL |
| `created_at` | INTEGER | NOT NULL |

Stores the top level of the vault hierarchy.

### `folders`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `topic_id` | TEXT | NOT NULL, FK `topics(id)` ON DELETE CASCADE |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` ON DELETE CASCADE |
| `name` | TEXT | NOT NULL |
| `created_at` | INTEGER | NOT NULL |

Stores folders under topics.

### `materials`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `folder_id` | TEXT | NOT NULL, FK `folders(id)` ON DELETE CASCADE |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` ON DELETE CASCADE |
| `box_type` | TEXT | NOT NULL |
| `title` | TEXT | nullable |
| `url` | TEXT | nullable |
| `local_path` | TEXT | nullable |
| `storage_status` | TEXT | NOT NULL DEFAULT `active` |
| `file_hash` | TEXT | nullable |
| `file_size` | INTEGER | nullable |
| `trashed_at` | INTEGER | nullable |
| `trash_path` | TEXT | nullable, added by migration 002 |
| `created_at` | INTEGER | NOT NULL |

Stores files, links, YouTube videos, and note materials. Files on disk are not stored as blobs; they live under `userData/local-files`.

Indexes:

- `idx_materials_folder` on `folder_id`
- `idx_materials_profile_status` on `(profile_id, storage_status)`
- `idx_materials_trashed` on `(profile_id, trashed_at)` where `trashed_at IS NOT NULL`

### `materials_fts`

Virtual FTS5 table over `materials.title` and `materials.url`. It is maintained by insert/update/delete triggers. It does not index PDF text or note content.

### `material_notes`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `material_id` | TEXT | NOT NULL, FK `materials(id)` ON DELETE CASCADE |
| `content` | TEXT | NOT NULL |
| `created_at` | INTEGER | NOT NULL |

Stores rich text note content per material. There is no `updated_at` column even though renderer types expose one.

### `video_progress`

| Column | Type | Constraints |
|---|---|---|
| `material_id` | TEXT | PRIMARY KEY, FK `materials(id)` ON DELETE CASCADE |
| `current_time` | REAL | NOT NULL DEFAULT 0 |
| `duration` | REAL | nullable |
| `last_watched` | INTEGER | NOT NULL |

Stores YouTube/video progress.

### `bookmarks`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` ON DELETE CASCADE |
| `url` | TEXT | NOT NULL |
| `title` | TEXT | nullable |
| `created_at` | INTEGER | NOT NULL |

Stores browser bookmarks.

### `daily_usage`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` ON DELETE CASCADE |
| `date` | TEXT | NOT NULL |
| `time` | TEXT | NOT NULL |
| `app_name` | TEXT | NOT NULL |
| `app_package` | TEXT | nullable |
| `app_category` | TEXT | nullable |
| `minutes` | INTEGER | NOT NULL |
| `source` | TEXT | NOT NULL DEFAULT `mobile` |
| `device_id` | TEXT | nullable |
| `received_at` | INTEGER | NOT NULL |

Stores imported/logged usage data. Indexes: `idx_usage_profile_date`, `idx_usage_app`.

### `activity_log`

| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` ON DELETE CASCADE |
| `action` | TEXT | NOT NULL |
| `metadata` | TEXT | nullable JSON |
| `created_at` | INTEGER | NOT NULL |

Stores app activity events. Index: `idx_activity_date`.

### `profile_settings`

| Column | Type | Constraints |
|---|---|---|
| `profile_id` | TEXT | PRIMARY KEY, FK `profiles(id)` ON DELETE CASCADE |
| `data` | TEXT | NOT NULL DEFAULT `{}` |
| `updated_at` | INTEGER | NOT NULL |

Stores settings JSON per profile.

### `profile_stats`

| Column | Type | Constraints |
|---|---|---|
| `profile_id` | TEXT | PRIMARY KEY, FK `profiles(id)` ON DELETE CASCADE |
| `data` | TEXT | NOT NULL DEFAULT `{}` |
| `updated_at` | INTEGER | NOT NULL |

Stores stats JSON per profile.

### `profile_theme`

| Column | Type | Constraints |
|---|---|---|
| `profile_id` | TEXT | PRIMARY KEY, FK `profiles(id)` ON DELETE CASCADE |
| `theme_data` | TEXT | NOT NULL DEFAULT `{}` |
| `overrides_data` | TEXT | NOT NULL DEFAULT `{}` |
| `updated_at` | INTEGER | NOT NULL |

Stores theme variables and CSS override JSON per profile.

### `document_chunks`

| Column | Type | Constraints |
|---|---|---|
| `chunk_id` | TEXT | PRIMARY KEY |
| `material_id` | TEXT | NOT NULL, FK `materials(id)` ON DELETE CASCADE |
| `page` | INTEGER | NOT NULL |
| `section` | TEXT | nullable |
| `chunk_type` | TEXT | NOT NULL |
| `text` | TEXT | NOT NULL |
| `bbox_x` | REAL | nullable |
| `bbox_y` | REAL | nullable |
| `bbox_w` | REAL | nullable |
| `bbox_h` | REAL | nullable |
| `embedding` | BLOB | nullable Float32 embedding |
| `chunk_order` | INTEGER | NOT NULL |
| `created_at` | INTEGER | NOT NULL |
| `chapter_id` | TEXT | nullable, added by migration 008 |
| `raw_text` | TEXT | nullable, added by migration 008 |
| `parent_summary_id` | TEXT | nullable, added by migration 008 |
| `is_toc` | INTEGER | NOT NULL DEFAULT 0, added by migration 010 |

Stores PDF chunks for RAG and vector search. Indexes: `idx_chunks_material`, `idx_chunks_page`, `idx_chunks_chapter`, `idx_chunks_is_toc`.

### `concept_index`

| Column | Type | Constraints |
|---|---|---|
| `material_id` | TEXT | PRIMARY KEY, FK `materials(id)` ON DELETE CASCADE |
| `index_json` | TEXT | NOT NULL DEFAULT `{}` |
| `status` | TEXT | NOT NULL DEFAULT `not_started` |
| `error_message` | TEXT | nullable |
| `total_chunks` | INTEGER | DEFAULT 0 |
| `created_at` | INTEGER | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

Stores ingestion status and a JSON concept map for a material.

### `professor_sessions`

| Column | Type | Constraints |
|---|---|---|
| `session_id` | TEXT | PRIMARY KEY |
| `material_id` | TEXT | NOT NULL, FK `materials(id)` ON DELETE CASCADE |
| `conversation_json` | TEXT | NOT NULL DEFAULT `[]` |
| `student_model_json` | TEXT | NOT NULL DEFAULT `{}` |
| `agenda_json` | TEXT | NOT NULL DEFAULT `[]` |
| `board_state_json` | TEXT | NOT NULL DEFAULT `null` |
| `last_page` | INTEGER | NOT NULL DEFAULT 1 |
| `created_at` | INTEGER | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

Stores AI tutor session state per material.

### `ingestion_queue`

| Column | Type | Constraints |
|---|---|---|
| `queue_id` | TEXT | PRIMARY KEY |
| `material_id` | TEXT | NOT NULL, FK `materials(id)` ON DELETE CASCADE |
| `local_path` | TEXT | NOT NULL |
| `status` | TEXT | NOT NULL DEFAULT `waiting` |
| `priority` | INTEGER | NOT NULL DEFAULT 0 |
| `attempts` | INTEGER | NOT NULL DEFAULT 0 |
| `error_message` | TEXT | nullable |
| `queued_at` | INTEGER | NOT NULL |

Stores resumable document ingestion jobs. Index: `idx_queue_status`.

### `db_meta`

| Column | Type | Constraints |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value` | TEXT | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

Stores runtime flags such as vector backfill status.

### `vec_chunk_map`

| Column | Type | Constraints |
|---|---|---|
| `rowid` | INTEGER | PRIMARY KEY |
| `chunk_id` | TEXT | NOT NULL UNIQUE, FK to `document_chunks(chunk_id)` after migration 007 |
| `material_id` | TEXT | NOT NULL |

Maps sqlite-vec row ids back to document chunks. Index: `idx_vec_map_material`.

### `vec_chunks`

Virtual table created at runtime in `SqliteVectorRepository.initialize()`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
  embedding float[384]
)
```

This is not created by migrations. It depends on the `sqlite-vec` extension loading correctly.

### `annotations`

| Column | Type | Constraints |
|---|---|---|
| `annotation_id` | TEXT | PRIMARY KEY |
| `material_id` | TEXT | NOT NULL, FK `materials(id)` ON DELETE CASCADE |
| `chunk_id` | TEXT | nullable, FK `document_chunks(chunk_id)` ON DELETE SET NULL |
| `page` | INTEGER | NOT NULL |
| `type` | TEXT | NOT NULL |
| `target_text` | TEXT | nullable |
| `color` | TEXT | NOT NULL DEFAULT `orange` |
| `callout` | TEXT | nullable |
| `bbox_x` | REAL | nullable |
| `bbox_y` | REAL | nullable |
| `bbox_w` | REAL | nullable |
| `bbox_h` | REAL | nullable |
| `stroke_data` | TEXT | nullable |
| `source` | TEXT | NOT NULL DEFAULT `user` |
| `created_at` | INTEGER | NOT NULL |

Stores PDF highlights, marks, and drawing strokes. Index: `idx_annotations_material`.

### `pdf_bookmarks`

| Column | Type | Constraints |
|---|---|---|
| `bookmark_id` | TEXT | PRIMARY KEY |
| `material_id` | TEXT | NOT NULL, FK `materials(id)` ON DELETE CASCADE |
| `page` | INTEGER | NOT NULL |
| `label` | TEXT | NOT NULL |
| `created_at` | INTEGER | NOT NULL |

Stores per-PDF page bookmarks. Index: `idx_bookmarks_material`.

Other persistent storage:

- `userData/local-files/`: imported files copied into the vault.
- `userData/local-files/.trash/`: soft-deleted imported files before purge.
- `userData/previews/`: cached PDFs generated from DOCX/ODT/RTF-like documents.
- `userData/ai-models/`: downloaded Transformers model files.
- `userData/secrets_store.json`: encrypted API keys when `safeStorage` is available.
- `userData/pin_store.enc`: encrypted launch PIN config when `safeStorage` is available.
- `userData/pin_config.json`: legacy/fallback plain PIN config. This can still be written if OS encryption is unavailable.
- `userData/legacy-backup.json`: localStorage migration backup.
- `userData/migration_journal.json`: legacy migration state.
- `localStorage`: workspace tabs, active tab, sidebar state, right panel state, library UI state, browser home page/search settings, and fallback/migration copies of PDF highlights/bookmarks/strokes.

Migration list from `electron/db/migrate.ts`:

| Version | Runtime filename | What it does |
|---:|---|---|
| 1 | `001_initial.sql` | Creates profiles, topics, folders, materials, notes, video progress, browser bookmarks, usage, activity log, material FTS, indexes, and FTS triggers. |
| 2 | `002_add_trash_path.sql` | Adds `materials.trash_path`. |
| 3 | `003_profile_config.sql` | Adds profile settings, stats, and theme tables. |
| 4 | `004_profiles_current.sql` | Adds `profiles.current`. |
| 5 | `005_professor_document_map.sql` | Adds document chunks, concept index, professor sessions, ingestion queue, and indexes. |
| 6 | `006_vec_infrastructure.sql` | Adds `db_meta` and `vec_chunk_map`. |
| 7 | `007_vec_chunk_map_fk.sql` | Rebuilds `vec_chunk_map` with FK to document chunks. |
| 8 | `008_structural_columns.sql` | Adds `chapter_id`, `raw_text`, and `parent_summary_id` to document chunks. |
| 9 | `009_annotations_table.sql` | Adds annotations and PDF bookmarks tables. |
| 10 | `010_is_toc_column.sql` | Adds `document_chunks.is_toc` and index. |

## Section 5: How to Set Up the Dev Environment

Required Node.js version is not enforced in `package.json`. The README says Node.js 18 or later. The current dependency set uses Electron 35, Vite 6, React 19, and Node 22 type definitions, so use a current LTS Node if possible.

This project is actively shaped around Windows. It includes `resources/pandoc/pandoc.exe`, `CorvoVault.vbs`, and a PowerShell kill script. Electron Builder has macOS and Linux icon settings, but there is no evidence in the repo that macOS or Linux builds are regularly tested.

```bash
# 1. Clone
git clone <repo-url>
cd study-in-center

# 2. Install
npm install

# The postinstall script rebuilds native modules for Electron:
# electron-rebuild -f -w better-sqlite3,keytar,sqlite-vec
# It also copies PDF.js worker assets.

# If native module rebuild fails:
npm run electron:rebuild

# 3. Environment variables
cp .env.example .env
```

The `.env` file is optional for normal use. API keys and configuration are entered in the app settings and stored locally.

Optional variables shown in `.env.example`:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_DRIVE_CLIENT_ID=
VITE_GOOGLE_DRIVE_FOLDER_ID=
```

Dev commands:

```bash
# Renderer only. Opens Vite at http://127.0.0.1:3000.
npm run dev

# Full desktop dev mode. Starts Vite, waits for port 3000, compiles Electron TS, then launches Electron.
npm run electron:dev

# Type check/lint command. This is tsc only, not ESLint.
npm run lint

# Tests
npm test

# Renderer production build only
npm run build

# Compile Electron main and start Electron against built/current assets
npm run electron:start
```

There is no ESLint config in the repo. The `lint` script is `tsc --noEmit`.

## Section 6: How to Build and Distribute

The distributable build command is:

```bash
npm run electron:build
```

That runs:

```bash
vite build && tsc -p electron/tsconfig.json && electron-builder
```

Outputs:

- Renderer build: `dist/`
- Electron main build: `dist-electron/`
- Packaged installer/build artifacts: `release/`

Electron Builder config is in `package.json` under `build`:

- `appId`: `com.corvovault.app`
- `productName`: `CorvoVault`
- Windows target: NSIS installer
- Windows icon: `public/icon.ico`
- macOS icon: `public/icon.icns`
- Linux icon: `public/icon.png`
- Extra resource: `resources/pandoc` copied to packaged resources
- Publish provider: GitHub repo `srkaran756/corvovault`

Signing/notarization:

- No code signing certificate configuration is present.
- No macOS notarization configuration is present.
- Windows NSIS output will be unsigned unless Electron Builder is configured externally through environment variables or local machine state.

Known build risks:

- Native modules (`better-sqlite3`, `keytar`, `sqlite-vec`) must be rebuilt for Electron. The project tries to do this in `postinstall`.
- The app relies on bundled `pandoc.exe`; non-Windows document conversion is not implemented by the bundled resource.
- SQL migrations must stay embedded in `electron/db/migrate.ts`; `.sql` files alone are not packaged by `tsc`.
- Auto-update is configured for GitHub Releases, but signing and release publishing are not documented.

## Section 7: Architecture Decisions

**Decision:** Local-first storage.

**Why:** The code stores core app data in SQLite under `app.getPath('userData')`, copies files into `userData/local-files`, and keeps API keys in local OS-backed storage.

**Trade-off:** No server-side sync, backup, or multi-device data model is present. Data loss protection depends on local disk and user exports.

**Status:** Core to the project and mostly consistent. Some renderer UI state still lives in `localStorage`.

**Decision:** Electron desktop app instead of a pure web app.

**Why:** The app needs local file import/copy, SQLite, native dialogs, a bundled webview browser, OS encryption, Pandoc conversion, and local model files.

**Trade-off:** Native module rebuilds, packaging complexity, larger runtime, and platform-specific behavior.

**Status:** Working for the intended desktop workflow. Windows is the only clearly supported platform.

**Decision:** Renderer uses preload IPC bridge.

**Why:** `contextIsolation`, `nodeIntegration: false`, and `sandbox: true` are enabled. Renderer code calls `window.electronAPI`.

**Trade-off:** IPC contracts must be maintained carefully. The exposed generic `invoke(channel, ...args)` bypasses the intended narrow bridge.

**Status:** Partly good, partly loose. Event subscriptions are allowlisted, but invoke calls are not.

**Decision:** Service/repository split for vault data.

**Why:** `ServiceHost` wires repository interfaces, SQLite repositories, application services, and facade services.

**Trade-off:** There is still direct logic in IPC handlers and `electron/main.ts`, so the split is not complete.

**Status:** Useful for vault CRUD. Needs more consistent validation and ownership boundaries.

**Decision:** Inline migrations in TypeScript.

**Why:** `tsc` does not copy `.sql` migration files into `dist-electron`, so runtime migrations are embedded in `electron/db/migrate.ts`.

**Trade-off:** SQL reference files can drift from runtime SQL. They already have drift: runtime migrations go to version 10; `electron/db/migrations/README.md` lists only 001-004.

**Status:** Correct runtime approach for the current build pipeline. Documentation/reference copies need discipline.

**Decision:** Local embeddings plus optional remote LLMs.

**Why:** Embeddings use `@xenova/transformers` locally with all-MiniLM-L6-v2. Chat responses use user-provided provider keys.

**Trade-off:** Ingestion is CPU-bound and can fail if `sqlite-vec` or model download/runtime fails. Remote LLM quality and cost depend on the user's key/provider.

**Status:** Ambitious and partially tested. It has more moving parts than the rest of the app.

**Decision:** Use Pandoc plus offscreen Electron printing for DOCX previews.

**Why:** The app converts office documents to HTML with Pandoc, then prints that HTML to PDF for viewer reuse.

**Trade-off:** It depends on a Windows `pandoc.exe`, a hidden BrowserWindow, timeouts, and cached preview files.

**Status:** Practical, but platform-specific.

**Decision:** Store API secrets using `safeStorage` first, keytar fallback.

**Why:** Comments in `SecretService` describe a migration from keytar to safeStorage.

**Trade-off:** Two secret storage paths remain. If OS encryption is unavailable, fallback behavior is less strong.

**Status:** Mostly reasonable. `keytar` should be removed only after the migration path is no longer needed.

## Section 8: Known Issues and Technical Debt

This section is not empty because the project has real debt.

1. Runtime migration docs are out of sync.

   `electron/db/migrate.ts` defines migrations 001-010. `electron/db/migrations/README.md` documents only 001-004, and `electron/db/migrations/005_add_document_chunks.sql` does not match runtime migration 005. A maintainer reading only the SQL folder will miss concept index, professor sessions, ingestion queue, vector infrastructure, annotations, PDF bookmarks, and TOC flags. Fix: make the `.sql` reference files match `migrate.ts` or generate them from the same source.

2. Generic IPC invoke weakens the preload boundary.

   `electron/preload.ts` exposes `invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)`. Renderer code uses it from `src/services/ipcService.ts`, `src/components/Settings.tsx`, `src/components/MigrationGate.tsx`, and `src/components/layout/TitleBar.tsx`. Event subscriptions are allowlisted, but invokes are not. If renderer code is compromised, any registered IPC channel can be called. Fix: replace generic invoke with explicit methods or an invoke allowlist plus validation.

3. Most IPC payloads are not validated.

   `vault:searchMaterials` uses Zod. Many other handlers accept `any` or unchecked strings, including profile sync, settings save, theme save, secret provider/key, professor annotations, session data, and migration snapshots. Bad input can corrupt JSON columns, create invalid rows, or trigger unexpected filesystem work. Fix: add shared schemas for each IPC channel.

4. The custom file protocol serves arbitrary existing paths.

   `electron/main.ts` registers `corvovault-file` and resolves paths, but the protocol handler checks existence and then calls `net.fetch(pathToFileURL(filePath))` without enforcing `assertInsideUserData`. Other file handlers do enforce `userData`. This means any local path encoded as `corvovault-file` may be readable by the renderer if it can construct the URL. Fix: apply the same userData allowlist or a signed-file-token scheme to protocol reads.

5. PIN storage can fall back to plain JSON.

   `electron/ipcHandlers/vaultHandlers.ts` writes `pin_config.json` if `safeStorage.isEncryptionAvailable()` is false. The code logs a warning, but the user may not see that. Fix: fail closed or show a clear UI warning before allowing fallback.

6. Professor/annotation storage loses geometry for text highlights.

   `src/hooks/usePdfSelection.ts` persists annotations with `target_text` but no rectangle data for text highlights. On reload, `rects` are rebuilt from text matching. If text matching changes, repeated text exists, or page extraction differs, old highlights can appear in the wrong place or disappear. Fix: persist normalized rectangles when available and use text matching as a fallback.

7. PDF annotation/bookmark migration still uses localStorage fallback paths.

   `src/hooks/usePdfSelection.ts`, `src/hooks/usePdfBookmarks.ts`, and `src/components/tabs/CustomPdfViewer.tsx` read/write old localStorage keys when IPC fails or for migration. That is useful for upgrades but means annotation state is split during failures. Fix: make SQLite the only write path once migration confidence is high.

8. PDF selection engine upgrade is unfinished.

   `TODO.md` lists unchecked work for selection performance, visual ordering, copy formatting, and highlight rectangle merging. The active file `src/components/tabs/CustomPdfViewer.tsx` also has a cleanup comment at line 1998 about a temporary row key. What breaks: selection/copy/highlighting can remain chunky or unstable on complex PDFs. Fix: complete the TODO checklist and add PDF fixture tests if possible.

9. Some errors are swallowed into `null`, `false`, or empty results.

   Examples include file deletion returning `false` in `electron/main.ts`, YouTube info returning `null`, URL title falling back to hostname, and several localStorage JSON parses with empty catches. This keeps the UI running but hides root causes. Fix: return typed error envelopes and show user-visible errors for operations that affect data.

10. `electron/main.ts` is too broad.

   It owns window creation, security policies, dialogs, file import/export, web search scraping, PDF download, trash purge, protocol handling, updater setup, and lifecycle. This makes it harder to test and reason about. Fix: move file, protocol, updater, web-search, and export logic behind services with focused tests.

11. Test schemas do not always match production schemas.

   Several tests create minimal in-memory tables by hand. For example `VaultPurgeApplicationService.test.ts` includes a `topic_id` column on `materials`, but production `materials` does not. Handwritten test schemas can drift from migrations. Fix: use `runMigrations()` in tests where practical, or centralize test schema creation.

12. The package contains generated or scratch artifacts at the repo root.

   `test_output.html`, `test_output2.html`, `test_db.js`, `crowvault.db`, and many files in `scratch/` are present. Some are useful debugging artifacts, but they blur what is production code. Fix: move scratch outputs under ignored folders or document which scripts are maintained.

13. Browser web search says SearXNG in UI but uses DuckDuckGo HTML in main.

   `preload.ts` exposes `searxngSearch`, and UI settings mention a SearXNG instance. `electron/main.ts` ignores the custom instance and scrapes DuckDuckGo HTML. What breaks: user settings do not do what they imply. Fix: either implement SearXNG support or rename the feature.

14. README points to deleted docs.

   `README.md` links to `docs/ENGINEERING.md`, but this repo currently needs the root-level `ENGINEERING.md` generated by this task. Git status also shows deleted `docs/ENGINEERING.md` and `docs/SOFTWARE_DESIGN.md`. Fix: update README links after deciding where engineering docs should live.

TODO/FIXME/HACK scan:

- `TODO.md:1` - `# TODO - PDF selection engine upgrade (copy / selection / highlights)`
- `src/hooks/useProfessorSession.ts:73` - `Safety guard: only save if there is some activity (avoids overwriting with blank template)`
- `electron/services/secretService.ts:19` - `Phase B (future, after safeStorage is confirmed stable in production): Remove all keytar import/calls and drop keytar from package.json rebuild.`
- `src/components/tabs/CustomPdfViewer.tsx:1998` - `Clean up the temporary row key (not needed after sort)`
- `electron/infrastructure/docxPreview.ts` has several empty catch blocks around temporary HTML cleanup. That is acceptable cleanup code, but it can hide repeated filesystem permission problems.

## Section 9: Testing

There are automated tests. Run them with:

```bash
npm test
```

Test configuration:

- `vitest.config.ts` includes `shared/**/*.test.ts` and `electron/**/*.test.ts` in Node environment.
- `vite.config.ts` also contains a Vitest block for renderer tests using `happy-dom`, but the root `npm test` script uses `vitest run`, which reads `vitest.config.ts`.

Tests found:

- `shared/ipc/schemas.test.ts`
- `src/hooks/useActivityTimer.test.ts`
- `electron/application/VaultPurgeApplicationService.test.ts`
- `electron/repositories/sqlite/SqliteFolderRepository.test.ts`
- `electron/repositories/sqlite/SqliteMaterialRepository.test.ts`
- `electron/repositories/sqlite/SqliteVectorRepository.test.ts`
- `electron/services/ingestionQueue.test.ts`
- `electron/services/professorService.test.ts`
- `electron/services/ragEvaluation.test.ts`

There are no full end-to-end Electron tests. There are no tests for most renderer workflows, file import/export, updater behavior, DOCX conversion, webview browser behavior, or packaged builds.

Most critical areas to test next:

- Migration execution against an empty database and an upgraded older database.
- IPC validation for settings, materials, annotations, and professor sessions.
- File import/trash/restore/purge, including disk state and SQLite state staying in sync.
- PDF annotation persistence and reload behavior.
- Ingestion queue failure/retry behavior with real PDFs.

## Section 10: Environment Variables and Configuration

Environment variables shown in `.env.example`:

| Variable | Required | What it controls | Missing behavior |
|---|---|---|---|
| `VITE_SUPABASE_URL` | No | Optional Supabase URL for settings/deployment scenarios | App still runs; user can enter settings in UI. |
| `VITE_SUPABASE_ANON_KEY` | No | Optional Supabase anon key | App still runs; user can enter settings in UI. |
| `VITE_GOOGLE_DRIVE_CLIENT_ID` | No | Optional Google Drive client id | App still runs; Google Drive is not core. |
| `VITE_GOOGLE_DRIVE_FOLDER_ID` | No | Optional Google Drive folder id | App still runs; Google Drive is not core. |

Other environment behavior:

- Runtime API keys for Gemini, OpenAI, Anthropic, and OpenRouter are stored through app settings/secrets, not required as environment variables.

Configuration and data locations:

- SQLite: `app.getPath('userData')/corvovault.db`
- Imported files: `app.getPath('userData')/local-files`
- Trash: `app.getPath('userData')/local-files/.trash`
- Preview cache: `app.getPath('userData')/previews`
- Model cache: `app.getPath('userData')/ai-models`
- Secret store: `app.getPath('userData')/secrets_store.json`
- PIN store: `app.getPath('userData')/pin_store.enc` or legacy/fallback `pin_config.json`
- Migration state: `app.getPath('userData')/migration_journal.json`
- Legacy backup: `app.getPath('userData')/legacy-backup.json`
- Renderer UI state: browser `localStorage`

## Section 11: Things a New Maintainer Must Know

The migration runner in `electron/db/migrate.ts` is the source of truth. Do not add only a `.sql` file. The packaged app will not run that file.

The repo is in the middle of a localStorage-to-SQLite migration history. Core vault data now goes to SQLite, but workspace state and several fallback/migration paths still use `localStorage`.

`npm run dev` is not the desktop app. Use `npm run electron:dev` for normal development.

Native module rebuilds matter. If Electron starts with native ABI errors, run `npm run electron:rebuild`.

`resources/pandoc/pandoc.exe` is required for document preview. The current repo is Windows-oriented.

The AI tutor has two separate layers: local ingestion/embeddings in Electron main, and remote LLM calls from the renderer using user API keys. Do not assume all AI work happens in one place.

The PDF viewer is custom and complex. `src/components/tabs/CustomPdfViewer.tsx`, `src/lib/pdfSelectionEngine.ts`, and the PDF hooks are tightly coupled.

`ServiceHost` is the composition root for most business services. Start there when tracing a main-process feature.

`electron/main.ts` still owns many unrelated concerns. Changes there can affect file import, protocol serving, updater, window behavior, browser helpers, and build/runtime startup.

The browser feature uses Electron `<webview>` with the `persist:browser` partition. Clearing browser cache clears cookies, localStorage, and IndexedDB for that partition, not the app renderer's own localStorage.

There is a custom protocol named `corvovault-file`. Be careful with it. File access rules must stay strict.

Some docs and metadata use old names: the package name is `corvovault`, but there is also `crowvault.db`, and the workspace path is `study-in-center`. Treat names carefully when searching.

## Section 12: Glossary

| Term | Meaning |
|---|---|
| Profile | A local user identity in the app. Profiles scope topics, folders, settings, theme, stats, and materials. |
| Topic | The top-level vault grouping under a profile. |
| Folder | A grouping under a topic. Materials belong to folders. |
| Material | A saved file, link, YouTube video, or note entry. |
| Vault | The local collection of topics, folders, materials, notes, files, and metadata. |
| `userData` | Electron's per-user application data directory. This is where the SQLite DB and imported files live. |
| Ingestion | Background extraction, chunking, embedding, and indexing of PDFs for the AI tutor. |
| Concept index | JSON state in SQLite describing document map/status for a material. |
| Professor | The code name for the AI tutor/RAG feature. |
| RAG | Retrieval-augmented generation: retrieve document chunks first, then ask an LLM to answer using those chunks. |
| TOC | Table of contents. TOC detection exists to keep front matter out of retrieval results. |

---

# Beginner Learning Guide

This part explains how the application works for someone who knows little or nothing about this codebase. Read it after the factual sections above. The goal is to build a mental model before editing code.

## The Big Picture

CorvoVault has two halves:

1. The renderer is the visible app. It is the React UI under `src/`.
2. The main process is the local operating-system side. It is the Electron code under `electron/`.

The renderer cannot directly read arbitrary files, write SQLite, or call native OS APIs. It asks the main process to do those things through IPC.

The simplest shape is:

```text
React UI
  -> preload bridge: window.electronAPI
  -> Electron IPC handler
  -> service/repository code
  -> SQLite or filesystem
  -> response back to React
```

If you remember only one thing, remember this: the UI asks, the main process does.

Important files:

- `src/main.tsx` starts React.
- `src/App.tsx` wraps the app in migration, auth, and tab providers.
- `electron/main.ts` starts Electron, opens the window, registers core IPC, runs migrations, and wires services.
- `electron/preload.ts` exposes `window.electronAPI` to the renderer.
- `src/services/ipcService.ts` is the renderer helper for many IPC calls.
- `electron/ServiceHost.ts` creates service and repository objects.

## How Electron Works Here

Electron apps have multiple processes. This project uses two that matter most:

- Main process: Node.js + Electron APIs. It can use the filesystem, SQLite, dialogs, native windows, and OS encryption.
- Renderer process: Chromium + React. It displays the UI.

The renderer is sandboxed:

```ts
contextIsolation: true
nodeIntegration: false
sandbox: true
```

That is why React code does not directly use `fs`, `path`, or `better-sqlite3`. Instead, `electron/preload.ts` exposes safe methods like:

```ts
window.electronAPI.openFileDialog()
window.electronAPI.copyFileToLocal(path)
window.electronAPI.professorGetAnnotations(materialId, page)
```

When a beginner sees this in React:

```ts
await window.electronAPI.copyFileToLocal(filePath)
```

they should read it as:

```text
Ask Electron main to copy this file into the app's private storage.
```

The matching handler is in `electron/main.ts`:

```ts
ipcMain.handle('file:copyToLocal', async (_event, sourcePath) => {
  ...
})
```

## How the Database Works

The app uses SQLite. SQLite is a single local database file, not a server.

The database file lives here:

```text
app.getPath('userData')/corvovault.db
```

On Windows this is usually somewhere under the user's AppData folder. Do not look for the real runtime database in the repo root. The root `crowvault.db` file is not the main runtime database path used by the app.

The database connection is created in:

```text
electron/db/connection.ts
```

The schema is created and upgraded by:

```text
electron/db/migrate.ts
```

Beginner meaning of migrations:

```text
A migration is a step that changes the database structure.
Example: create a table, add a column, add an index.
```

The app runs migrations on startup:

```text
app.whenReady()
  -> getDb()
  -> runMigrations(db)
```

### The Main Data Shape

The vault hierarchy is:

```text
Profile
  -> Topic
    -> Folder
      -> Material
        -> Notes, video progress, annotations, PDF bookmarks, document chunks
```

Plain meaning:

- A profile is a local user.
- A topic is a subject.
- A folder is a group inside a subject.
- A material is one saved item: file, link, YouTube video, or note.

For example:

```text
Profile: Default User
  Topic: Physics
    Folder: Quantum Mechanics
      Material: chapter-1.pdf
```

Tables involved:

- `profiles`
- `topics`
- `folders`
- `materials`
- `material_notes`
- `video_progress`
- `annotations`
- `pdf_bookmarks`
- `document_chunks`

### How One Database Write Happens

Example: creating a topic.

```text
User clicks "Add Topic"
  -> src/components/Library.tsx calls addTopic()
  -> src/hooks/useLocalData.ts calls ipcService.topics.create()
  -> src/services/ipcService.ts invokes "topics:create"
  -> electron/ipcHandlers/vaultHandlers.ts receives it
  -> serviceHost.vault.createTopic(profileId, name)
  -> TopicApplicationService ensures the profile exists
  -> SqliteTopicRepository inserts into topics
  -> React updates local state so the topic appears
```

Files to read in order:

1. `src/components/Library.tsx`
2. `src/hooks/useLocalData.ts`
3. `src/services/ipcService.ts`
4. `electron/ipcHandlers/vaultHandlers.ts`
5. `electron/services/vaultService.ts`
6. `electron/application/TopicApplicationService.ts`
7. `electron/repositories/sqlite/SqliteTopicRepository.ts`

That reading order teaches the usual renderer-to-database flow.

### Repositories and Services

A repository is code that knows SQL.

Example:

```text
SqliteTopicRepository
  -> INSERT INTO topics ...
  -> SELECT FROM topics ...
```

A service is code that decides what should happen.

Example:

```text
TopicApplicationService
  -> make sure profile exists
  -> ask repository to create topic
```

This project uses both, but not perfectly everywhere. Some logic still lives directly inside IPC handlers or `electron/main.ts`.

## How File Storage Works

The database stores metadata. The actual imported files stay on disk.

When a user imports a PDF:

```text
Original file: C:\Users\...\Downloads\book.pdf
Copied file:   userData\local-files\173..._book.pdf
Database row:  materials.local_path = copied file path
```

Why copy the file?

- The app owns the copied version.
- The original file can be moved or deleted without immediately breaking the vault copy.
- The app can hash and track the copied file.

Important file IPC handlers in `electron/main.ts`:

- `file:copyToLocal`
- `file:deleteLocal`
- `file:readBase64`
- `file:hashFile`
- `file:moveToTrash`
- `file:restoreFromTrash`
- `file:purgeTrash`
- `file:exportZip`

Trash works in two places:

```text
Filesystem:
  local-files/file.pdf
    -> local-files/.trash/timestamp_file.pdf

SQLite:
  materials.storage_status = "trashed"
  materials.trashed_at = timestamp
  materials.trash_path = path in .trash
```

Both must stay in sync. If you change trash behavior, check both disk movement and database updates.

## How the PDF Viewer Works

The PDF viewer is one of the most complex parts of the app.

Important files:

- `src/components/tabs/DocumentViewer.tsx`
- `src/components/tabs/CustomPdfViewer.tsx`
- `src/hooks/usePdfDocument.ts`
- `src/hooks/usePdfSelection.ts`
- `src/hooks/usePdfBookmarks.ts`
- `src/lib/pdfSelectionEngine.ts`

The app uses PDF.js to load and render PDF files.

Beginner meaning of PDF.js:

```text
PDF.js reads a PDF file in JavaScript and gives the app pages, text items, sizes, and drawing operations.
```

### Loading a PDF

```text
Document tab opens a material
  -> DocumentViewer decides what kind of material it is
  -> PDF material uses CustomPdfViewer
  -> usePdfDocument loads PDF.js
  -> usePdfDocument reads the file
  -> PDF.js returns a pdfDoc object
  -> CustomPdfViewer renders pages
```

`usePdfDocument.ts` tries to read local Electron files as base64 through IPC:

```text
React asks Electron main: does this file exist?
React asks Electron main: read this file as base64
PDF.js receives bytes
PDF.js creates a document object
```

This avoids some packaged-app and local-file URL problems.

### Rendering Pages

PDF pages have their own coordinate system. The app has to translate between:

- PDF coordinates
- canvas coordinates
- DOM coordinates
- scroll container coordinates
- normalized coordinates stored in the database

That is why PDF code looks math-heavy. It is not just drawing a page. It is keeping text, highlights, selection rectangles, annotations, zoom, rotation, and scroll position aligned.

### Text Selection Engine

Browsers already support selecting text, but PDF text layers are not always reliable. PDFs often contain text as many small positioned fragments. One word may be split into pieces. A line may not be stored in reading order. Two-column PDFs make this harder.

This app has a custom selection engine:

```text
src/lib/pdfSelectionEngine.ts
```

Its job:

1. Take PDF.js text items.
2. Convert them into positioned text fragments.
3. Detect where the mouse pointer is in those fragments.
4. Decide selection start and end.
5. Build highlight rectangles.
6. Build copied text.

The high-level flow is:

```text
User drags over PDF text
  -> pointer position goes to usePdfSelection
  -> usePdfSelection calls findSelectionPoint()
  -> pdfSelectionEngine finds the nearest text character/item
  -> selection start/end are stored
  -> getCustomSelectionRects() computes visual rectangles
  -> getCustomSelectionText() builds text for copy
  -> SelectionToolbar lets user copy/highlight/underline/strike
```

Why this is hard:

- PDFs do not always store text in visual order.
- Text can be rotated.
- Columns can confuse ordering.
- The same words can appear many times on a page.
- Highlight rectangles must match zoomed/scaled page rendering.

The TODO in `TODO.md` is about this area. It says selection performance, copy formatting, and highlight rectangle merging still need work.

### PDF Highlights and Drawings

There are several kinds of annotation-like data:

- Text highlights
- Underlines
- Strike marks
- Circles/arrows
- Freehand strokes
- AI-generated highlights
- PDF bookmarks

The newer storage path is SQLite through professor annotation IPC:

```text
professor:getAnnotations
professor:saveAnnotation
professor:deleteAnnotation
professor:getPdfBookmarks
professor:savePdfBookmark
professor:deletePdfBookmark
```

Older/fallback paths still use `localStorage`.

Beginner warning: if you change annotation behavior, search both SQLite annotation code and localStorage fallback code.

## How DOCX Preview Works

DOCX files are not rendered directly by the PDF viewer. The app converts them.

Important file:

```text
electron/infrastructure/docxPreview.ts
```

Flow:

```text
User opens DOCX
  -> renderer calls convertDocxToHtml()
  -> Electron main calls enqueueDocxConversion()
  -> Pandoc converts DOCX to temporary HTML
  -> hidden BrowserWindow loads the HTML
  -> Electron prints the hidden page to PDF
  -> cached PDF is saved under userData/previews
  -> renderer opens that cached PDF
```

This is clever because it reuses the PDF viewer. It is also fragile because it depends on:

- bundled `resources/pandoc/pandoc.exe`
- hidden Electron window rendering
- timeouts
- cached preview files

## How the AI Tutor and RAG Work

The AI feature has two major phases:

1. Ingestion: prepare the document for search.
2. Chat: retrieve relevant chunks and ask an LLM to answer.

### Phase 1: Ingestion

Ingestion happens in the Electron main process.

Important files:

- `electron/services/ingestionQueue.ts`
- `electron/services/embeddingService.ts`
- `electron/services/professorService.ts`
- `electron/repositories/sqlite/SqliteVectorRepository.ts`
- `electron/services/tocDetector.ts`

When a PDF is imported:

```text
vault:capture creates a material row
  -> vaultHandlers sees it is a PDF
  -> ingestionQueue.enqueue(material.id, material.localPath)
  -> ingestion_queue row is created
  -> concept_index status becomes queued
  -> queue processes the PDF in the background
```

The ingestion queue does this:

```text
Read PDF with PDF.js
  -> extract text and page positions
  -> skip pages that look like TOC/front matter
  -> split text into chunks
  -> create embeddings with local Transformers model
  -> store chunks in document_chunks
  -> store embeddings as BLOBs
  -> insert vectors into sqlite-vec table
  -> update concept_index status to ready
  -> notify renderer with professor:ingestionProgress
```

Beginner meaning of an embedding:

```text
An embedding is a list of numbers that represents the meaning of text.
Similar text gets similar number lists.
```

This project uses 384-number embeddings from:

```text
Xenova/all-MiniLM-L6-v2
```

The app stores those numbers in SQLite as binary blobs.

### Phase 2: Retrieval

When the user asks a question, the app needs to find useful document chunks.

Important file:

```text
electron/services/professorService.ts
```

The retrieval system classifies the question. Examples:

- Current page question
- Chapter summary
- Fact lookup
- Comparison
- General semantic question

Then it retrieves chunks using a mix of:

- page/chapter metadata
- text matching/BM25-style scoring
- vector similarity through sqlite-vec
- filters to avoid TOC pollution

Plain meaning:

```text
Before asking the LLM, the app tries to find the parts of the PDF that probably answer the user's question.
```

### Phase 3: LLM Answer

The renderer coordinates the final LLM call.

Important files:

- `src/components/tabs/AiTutorPanel.tsx`
- `src/lib/ai.ts`
- `src/lib/gemini.ts`
- `src/hooks/useProfessorSession.ts`

Flow:

```text
User types a question
  -> AiTutorPanel sends classifyAndRetrieve IPC
  -> professorService returns relevant chunks and intent
  -> AiTutorPanel builds a system prompt
  -> src/lib/ai.ts calls selected provider
  -> provider returns JSON with speech, annotations, board actions, optional page navigation
  -> AiTutorPanel renders the answer
  -> PDF annotations are applied
  -> blackboard actions are drawn
  -> session is saved
```

The app supports multiple providers through user settings:

- Gemini
- OpenAI
- Anthropic
- OpenRouter

Keys are stored locally. The LLM calls are not the same as embeddings. Embeddings are local; LLM answers are remote unless the provider points to some local-compatible endpoint in future work.

### What RAG Means in This App

RAG means:

```text
Retrieve useful document text first.
Then generate an answer using that retrieved text.
```

Without RAG:

```text
User asks: "What does page 12 say about X?"
LLM guesses from general training.
```

With RAG:

```text
User asks: "What does page 12 say about X?"
App retrieves chunks from page 12 or related sections.
LLM receives those chunks.
LLM must cite those chunks.
```

The app tries to force grounded answers by building prompts that say:

- use only provided document sections
- cite claims
- say when the document does not contain enough information
- return JSON so the UI can draw highlights and board actions

This is why AI code has a lot of prompt and validation logic.

## How the Browser Works

The app has a built-in browser based on Electron `<webview>`.

Important file:

```text
src/components/Browser.tsx
```

The browser has its own persistent session:

```text
partition="persist:browser"
```

That means website cookies and website localStorage live in the browser partition, not in the app renderer's own localStorage.

Browser preferences such as homepage and default search engine are stored in renderer `localStorage`.

The browser can capture the current page as a material:

```text
Current webview tab
  -> user clicks Capture
  -> Browser creates link/youtube material data
  -> useMaterials.addMaterial()
  -> vault:capture
  -> materials row in SQLite
```

## How Settings and Secrets Work

Settings are split into ordinary settings and secrets.

Ordinary settings:

```text
profile_settings.data JSON in SQLite
```

Examples:

- study target minutes
- focus time
- selected AI model
- Supabase/Google Drive config objects

Secrets:

```text
safeStorage encrypted file under userData/secrets_store.json
```

Examples:

- Gemini key
- OpenAI key
- Anthropic key
- OpenRouter key

Important files:

- `electron/services/settingsService.ts`
- `electron/services/secretService.ts`
- `electron/ipcHandlers/settingsHandlers.ts`
- `electron/ipcHandlers/secretHandlers.ts`
- `src/components/Settings.tsx`

Do not store API keys directly in SQLite settings JSON unless the code is intentionally changed. The project already has a secret service for that.

## How Startup Works

Startup order matters.

```text
Electron starts
  -> app.whenReady()
  -> createWindow()
  -> getDb()
  -> runMigrations()
  -> create ServiceHost
  -> resume ingestion queue
  -> register protocol and IPC handlers
  -> setup updater
```

Renderer startup:

```text
React starts
  -> MigrationGate checks old localStorage migration state
  -> AuthProvider loads profiles/current profile/settings
  -> App checks PIN
  -> TabProvider restores workspace tabs
  -> AppShell renders the UI
```

If the app starts blank or behaves strangely, check both startup paths:

- main-process startup in `electron/main.ts`
- renderer startup in `src/App.tsx`, `MigrationGate`, and `AuthContext`

## How to Read the Code as a Beginner

Do not start with the biggest file. Start with one user action.

Good first flows:

1. Create a topic.
2. Import a PDF.
3. Open a PDF.
4. Add a highlight.
5. Ask the AI tutor one question.

For each flow, trace this path:

```text
UI component
  -> hook or helper
  -> ipcService/window.electronAPI
  -> preload channel
  -> ipcMain handler
  -> service
  -> repository/database/filesystem
```

When you get lost, ask:

- Am I in renderer code or main-process code?
- Is this data in SQLite, localStorage, or the filesystem?
- Is this action synchronous UI state, IPC state, or background queue state?
- Is this old migration fallback code or the current primary path?

## Suggested Learning Order

Read these files in this order if you are new:

1. `README.md` for the product summary.
2. `package.json` for commands and dependencies.
3. `src/App.tsx` for renderer startup.
4. `electron/main.ts` for main startup and IPC registration.
5. `electron/preload.ts` for the bridge between the two worlds.
6. `src/services/ipcService.ts` for renderer IPC helpers.
7. `electron/db/migrate.ts` for database shape.
8. `electron/ServiceHost.ts` for service wiring.
9. `src/hooks/useLocalData.ts` for common UI data operations.
10. `electron/services/vaultService.ts` for vault business operations.
11. `src/components/tabs/CustomPdfViewer.tsx` only after understanding PDF basics.
12. `electron/services/ingestionQueue.ts` and `electron/services/professorService.ts` for RAG.
13. `src/components/tabs/AiTutorPanel.tsx` for the final AI UI flow.

## Common Beginner Mistakes

Mistake: changing a TypeScript type and assuming the database changed.

Reality: database schema changes must be added to `electron/db/migrate.ts`.

Mistake: changing a `.sql` file and assuming the app will run it.

Reality: runtime migrations are embedded in `electron/db/migrate.ts`.

Mistake: reading `localStorage` and assuming it is the main data store.

Reality: core data is SQLite. Some UI state and migration fallbacks still use `localStorage`.

Mistake: calling Node APIs from React.

Reality: renderer code must go through `window.electronAPI`.

Mistake: thinking the PDF highlight stores only rectangles.

Reality: text highlights often store target text and reconstruct rectangles later, which can fail on repeated or changed text.

Mistake: thinking the AI reads the whole PDF every time.

Reality: the app ingests the PDF into chunks first, then retrieves relevant chunks for each question.

Mistake: thinking embeddings and LLM answers are the same thing.

Reality: embeddings are local numeric representations for search. LLM answers come from remote provider APIs using the user's key.

I created a new branch to fix the chunking function. and here is what I found.