# ENGINEERING.md — Architecture & Technical Specification

> *CorvoVault System Architecture & Engineering Documentation for Open-Source Maintainers and Contributors.*

---

## Section 0: System Architecture & Capabilities

### Overview

CorvoVault is a **local-first desktop application** built to support the journey of learning. Rather than treating study resources as isolated files, CorvoVault integrates PDFs, websites, YouTube videos, Markdown notes, courses, and AI conversations into a unified, privacy-centric workspace.

The architecture emphasizes **security, local data ownership, and process isolation**:
- All core data, documents, and embeddings stay strictly local under `app.getPath('userData')`.
- Heavy database operations, document chunking, ONNX vector embeddings, and proxy operations run in the Electron main process to prevent UI thread blocking.
- Custom file serving is handled securely via the `corvovault-file://` custom protocol.

### Application Stage & Features (v2 Development Phase)

- **PDF Ingestion & Annotation Engine**: Custom canvas viewer supporting text highlighting, freehand drawing, page bookmarks, rotation, and verbatim coordinate extraction.
- **DOCX / Document Previews**: Inline DOCX conversion to previewable PDF via bundled Pandoc.
- **Standalone & Material Notes**: Full Markdown editing with inline KaTeX math (`$...$`, `$$...$$`), live Mermaid diagrams, and DuckDuckGo image search embedding.
- **YouTube Rescue Player & Multi-Layer Adblocker**: Embedded player with progress tracking, `@ghostery/adblocker-electron` network filtering, InnerTube API JSON payload sanitization, and HTML5 video auto-skip fallbacks.
- **In-App Web Browser & Privacy Proxy**: Multi-tab Chromium webviews, download prompt interceptor, history tracking, domain render mode caching, and Deep Ignoto DNS-over-HTTPS privacy mode.
- **Online Course Workspace**: 60-course catalog browser with scraped lesson extraction and per-course workspace.
- **Local OCR Engine**: Integrated OCR cache (`ocr_cache` table) supporting PaddleOCR document image text extraction.
- **Hybrid Vector RAG Pipeline**: Local ONNX embeddings (`Xenova/all-MiniLM-L6-v2`), BM25 full-text search + `sqlite-vec` KNN cosine similarity, RRF ranking, governed by central feature flags (`electron/config/featureFlags.ts`).
- **Database & Migration Engine**: 16 versioned SQLite migrations applied atomically at startup in WAL mode.

---

## Section 1: What This Project Is

CorvoVault is a **local-first Electron desktop application** for organizing study materials. The user interacts through a React UI that can import files, save links and YouTube videos, read PDFs (with annotation), preview DOCX files, take Markdown notes, browse the web, and — when enabled — ask an AI tutor questions about documents.

The app stores its core data in SQLite under `app.getPath('userData')`. Imported files are copied into `userData/local-files/`. There is no required server.

**Key identity decisions:**

- Local-first: your data never leaves your machine unless you set up optional cloud sync
- Privacy: Deep Ignoto browser mode routes through a local DNS-over-HTTPS proxy with tracker blocking
- Open: user brings their own LLM API keys (Gemini, OpenAI, Anthropic, OpenRouter)
- Offline-capable: embedding model is cached locally; PDF viewing and note-taking work without internet

---

## Section 2: Tech Stack

| Technology | Version | Role | Notes |
|---|---:|---|---|
| Electron | ^35.2.1 | Desktop shell, main process, preload bridge, webview host | Central to the entire design. |
| React | ^19.0.0 | Renderer UI | Tabbed desktop interface, vault, PDF reader, settings, browser, notes, courses. |
| TypeScript | ~5.8.2 | Main and renderer language | Separate `tsconfig.json` files for renderer (Vite) and main (`electron/tsconfig.json`). |
| Vite | ^6.2.0 | Renderer bundler/dev server | `npm run dev` starts only Vite. `npm run electron:dev` starts both. |
| Tailwind CSS | ^4.1.14 | CSS utility layer | Loaded via `@tailwindcss/vite` plugin. |
| better-sqlite3 | ^12.9.0 | Local SQLite access | Synchronous DB in Electron main. Native module — must be rebuilt for each Electron ABI. |
| SQLite FTS5 | bundled | Full-text search for materials | `materials_fts` virtual table. Maintained by INSERT/UPDATE/DELETE triggers. |
| sqlite-vec | ^0.1.7 | Vector similarity search | `vec_chunks` virtual table for KNN cosine search. Falls back gracefully if unavailable. |
| @xenova/transformers | ^2.17.2 | Local embedding generation | `Xenova/all-MiniLM-L6-v2` (quantized, ~22MB). CPU-only ONNX. Cached in `userData/ai-models/`. |
| @langchain/textsplitters | ^1.0.1 | Text chunking | `RecursiveCharacterTextSplitter` in `ingestionQueue.ts`. chunkSize=512, overlap=64. |
| pdfjs-dist | ^4.10.38 | PDF parsing and rendering | Used in ingestion (main process text extraction) and renderer (PDF viewer pages). |
| pdf-parse | ^2.4.5 | PDF parsing dep | Listed in package.json. **No direct import found in app source.** Likely transitive or legacy. |
| @google/genai | ^1.29.0 | Gemini API client | AI responses routed through `src/lib/ai.ts`. User-provided keys required. |
| @supabase/supabase-js | ^2.103.0 | Optional cloud settings test | Settings connection test only. Not part of core local data path. |
| keytar | ^7.9.0 | Legacy/fallback secret storage | `SecretService` prefers `safeStorage`. keytar remains as migration fallback. Native module. |
| lucide-react | ^0.546.0 | Icons | Used throughout UI. |
| motion | ^12.23.24 | Animation | `AnimatePresence` and motion components in layout. |
| recharts | ^3.8.1 | Charts | Dashboard/stats UI. Currently renders zero data (no source writes `daily_usage`). |
| fuse.js | ^7.4.2 | Fuzzy search | Listed. **No direct app-source import found.** |
| archiver | ^7.0.1 | ZIP export | Vault export in `fileHandlers.ts`. |
| check-disk-space | ^3.4.0 | Pre-import disk guard | Checked before copying files to vault. |
| electron-updater | ^6.8.3 | GitHub Release auto-updates | Configured for production builds only. |
| zod | ^4.4.3 | IPC input validation | Currently only used for `vault:searchMaterials`. Most handlers still accept `any`. |
| katex | ^0.16.45 | Math rendering | KaTeX renders `$...$` inline and `$$...$$` display math in `MarkdownRenderer.tsx`. |
| marked | ^18.0.7 | Markdown parsing | Used in `MarkdownRenderer.tsx` to convert Markdown to HTML. |
| mermaid | ^11.16.0 | Diagram rendering | Dynamic Mermaid diagram rendering in `MarkdownRenderer.tsx`. |
| @ghostery/adblocker-electron | ^2.18.0 | Ad blocking in browser | Applied to `persist:browser` session. ChatGPT/OpenAI bypass patched inline in `main.ts`. |
| Vitest | ^4.1.6 | Unit tests | Covers repositories, IPC schemas, activity timer, RAG services. |
| npm | lock v3 | Package manager | `package-lock.json` present. No pnpm/yarn. |

**Dead or questionable dependencies:**

- `pdf-parse`: listed, no app-source import found
- `fuse.js`: listed, no app-source import found
- `autoprefixer`: listed, no PostCSS config. Tailwind 4 uses Vite plugin only.

---

## Section 3: Repository Structure

Actual source tree (excluding `node_modules`, `dist`, `dist-electron`, `release`):

```
.
+-- electron/
|   +-- application/           # Application services (business logic above repositories)
|   |   +-- BookmarkApplicationService.ts
|   |   +-- FolderApplicationService.ts
|   |   +-- IntegrityApplicationService.ts
|   |   +-- MaterialApplicationService.ts
|   |   +-- NoteApplicationService.ts
|   |   +-- ProfileApplicationService.ts
|   |   +-- TopicApplicationService.ts
|   |   +-- TrashApplicationService.ts
|   |   +-- VaultPurgeApplicationService.ts  (+ .test.ts)
|   |   +-- VideoProgressApplicationService.ts
|   +-- config/
|   |   +-- featureFlags.ts    # ENABLE_RAG_PIPELINE toggle -- single source of truth
|   +-- db/
|   |   +-- connection.ts      # better-sqlite3 connection singleton
|   |   +-- migrate.ts         # ALL migrations embedded as TS strings (16 versions)
|   |   +-- migrations/        # Reference .sql files (BEHIND runtime -- not executed by packaged builds)
|   +-- infrastructure/
|   |   +-- docxPreview.ts     # Pandoc + hidden BrowserWindow -> PDF conversion
|   +-- ipcHandlers/
|   |   +-- analyticsHandlers.ts
|   |   +-- courseHandlers.ts  # WARNING Large: scraping, catalog, cache all in one file
|   |   +-- dialogHandlers.ts
|   |   +-- downloadHandler.ts # Webview download interceptor + prompt system
|   |   +-- fileHandlers.ts    # File copy, hash, trash, restore, export
|   |   +-- ignotoHandlers.ts  # Privacy proxy session management
|   |   +-- migrationHandlers.ts
|   |   +-- ocrHandlers.ts     # OCR cache read/write (IPC only, no inference yet)
|   |   +-- professorHandlers.ts
|   |   +-- secretHandlers.ts
|   |   +-- settingsHandlers.ts
|   |   +-- themeHandlers.ts
|   |   +-- updaterHandlers.ts
|   |   +-- vaultHandlers.ts
|   |   +-- webHandlers.ts     # Browser history, search, browsing data
|   |   +-- windowHandlers.ts
|   +-- mappers/               # DB row -> domain model converters
|   |   +-- folderMapper.ts
|   |   +-- materialMapper.ts
|   |   +-- topicMapper.ts
|   +-- repositories/
|   |   +-- interfaces/        # TypeScript interfaces (not SQLite-aware)
|   |   +-- sqlite/            # SQLite implementations
|   |       +-- SqliteActivityRepository.ts
|   |       +-- SqliteBookmarkRepository.ts
|   |       +-- SqliteFolderRepository.ts  (+ .test.ts)
|   |       +-- SqliteMaterialRepository.ts  (+ .test.ts)
|   |       +-- SqliteNoteRepository.ts
|   |       +-- SqliteTopicRepository.ts
|   |       +-- SqliteVectorRepository.ts  (+ .test.ts)
|   |       +-- SqliteVideoProgressRepository.ts
|   +-- services/
|   |   +-- analyticsService.ts
|   |   +-- courseExtractionService.ts  (+ .test.ts)
|   |   +-- embeddingService.ts         # @xenova ONNX, lazy-init, adaptive batch size
|   |   +-- ignotoProxy.ts              # Zero-dep Node.js HTTP/HTTPS proxy w/ DoH + tracker blocklist
|   |   +-- ingestionQueue.ts           # Persistent queue; BBox extraction; chunk/embed/index pipeline
|   |   +-- professorService.ts         # BM25 + RRF + vector retrieval; tool execution; concept index
|   |   +-- ragEvaluation.test.ts
|   |   +-- secretService.ts            # safeStorage -> keytar fallback chain
|   |   +-- settingsService.ts
|   |   +-- themeService.ts
|   |   +-- tocDetector.ts              # Heuristic for identifying TOC pages to exclude from indexing
|   |   +-- vaultService.ts             # Facade over all application services
|   +-- utils/
|   |   +-- cryptoUtils.ts              # Buffer encrypt/decrypt for local file encryption
|   +-- main.ts                         # Entry point: window, protocol, IPC registration, lifecycle
|   +-- preload.ts                      # contextBridge: window.electronAPI (all channels)
|   +-- ServiceHost.ts                  # Composition root: wires repos -> services -> professor + queue
|   +-- tsconfig.json
+-- public/                    # Renderer assets, icons, PDF.js worker files
+-- resources/
|   +-- pandoc/pandoc.exe      # Bundled Windows Pandoc for DOCX conversion
+-- scratch/                   # Ad-hoc debugging scripts (not production)
+-- scripts/                   # PDF.js copy script, icon generation, kill script
+-- shared/
|   +-- ipc/
|       +-- envelope.ts        # IpcResult<T> type for typed IPC responses
|       +-- schemas.ts         # Zod schemas (currently only searchMaterials)
|       +-- schemas.test.ts
+-- src/
|   +-- components/
|   |   +-- Browser.tsx                # In-app browser (webview + tabs + history + Ignoto mode)
|   |   +-- Capture.tsx                # File/URL/YouTube import UI
|   |   +-- Dashboard.tsx              # Stats/heatmap/activity (currently all-zero data)
|   |   +-- DesignPlayground.tsx       # Theme provider/context wrapper
|   |   +-- Library.tsx                # Topic/folder/material browser + search
|   |   +-- MarkdownRenderer.tsx       # Markdown->HTML + KaTeX math + Mermaid diagrams
|   |   +-- MigrationGate.tsx          # localStorage->SQLite migration check on first load
|   |   +-- ProfileAvatar.tsx
|   |   +-- Settings.tsx               # All settings UI (keys, theme, study targets, danger zone)
|   |   +-- TopBar.tsx                 # Window title bar + tab bar + controls
|   |   +-- Vault/
|   |   |   +-- DocxPreview.tsx
|   |   |   +-- LibraryCard.tsx
|   |   |   +-- PdfSearchPanel.tsx
|   |   |   +-- PreviewModal.tsx       # Material preview overlay (PDF, image, link, video)
|   |   |   +-- PreviewNoteCard.tsx
|   |   |   +-- YouTubePlayer.tsx      # YouTube player with progress persistence
|   |   +-- layout/
|   |   |   +-- AppShell.tsx
|   |   |   +-- DevDownloadInspector.tsx   # Dev-only download debug panel
|   |   |   +-- DownloadPromptModal.tsx    # Download destination chooser (vault / course / disk)
|   |   |   +-- TitleBar.tsx
|   |   +-- tabs/
|   |       +-- AiTutorPanel.tsx       # AI tutor chat UI (84KB -- the most complex component)
|   |       +-- BlackboardCanvas.tsx   # Drawing canvas for AI board actions
|   |       +-- BrowserView.tsx
|   |       +-- ClipView.tsx
|   |       +-- CourseExplorer.tsx     # Course catalog browser
|   |       +-- CourseWorkspace.tsx    # Per-course lesson/video/resource workspace (121KB)
|   |       +-- CustomPdfViewer.tsx    # Custom PDF renderer with text selection engine (87KB)
|   |       +-- CustomizeView.tsx
|   |       +-- DocumentViewer.tsx     # Material type router (PDF/DOCX/image/video/link)
|   |       +-- MathInsertModal.tsx    # KaTeX formula builder for notes
|   |       +-- NoteEditor.tsx         # Rich Markdown note editor with web image search (45KB)
|   |       +-- NotesWorkspace.tsx     # Standalone notes tab workspace (62KB)
|   |       +-- PdfSidebar.tsx
|   |       +-- PdfToolbar.tsx
|   |       +-- SelectionToolbar.tsx   # PDF text selection toolbar (highlight/underline/copy)
|   |       +-- SettingsView.tsx
|   |       +-- TodayView.tsx
|   |       +-- VaultView.tsx
|   +-- contexts/
|   |   +-- AuthContext.tsx     # Profile load, settings, IPC boot sequence
|   |   +-- TabContext.tsx      # Tab open/close/activate, localStorage persistence
|   +-- events/
|   +-- hooks/
|   |   +-- useActivityTimer.ts  (+ .test.ts)
|   |   +-- useIngestionStatus.ts
|   |   +-- useKeyboardShortcuts.ts
|   |   +-- useLocalData.ts       # Topic/Folder/Material CRUD hooks + event subscriptions
|   |   +-- useOverscroll.ts
|   |   +-- usePdfAnnotations.ts
|   |   +-- usePdfBookmarks.ts
|   |   +-- usePdfDocument.ts
|   |   +-- usePdfSelection.ts    # Custom text selection engine hook (25KB)
|   |   +-- useProfessorSession.ts
|   |   +-- useTabs.ts
|   |   +-- useWebviewNavigation.ts
|   +-- lib/
|   |   +-- ai.ts               # Remote LLM orchestration (tool loop, fallback parsing)
|   |   +-- editorUtils.tsx     # Note editor helper utilities
|   |   +-- ocrService.ts       # Client-side OCR service (frontend side)
|   |   +-- pdfSelectionEngine.ts  # Custom PDF text selection algorithm
|   |   +-- rag/                # Client-side RAG helpers
|   |   +-- theme.ts
|   +-- services/
|   |   +-- ipcService.ts       # Renderer-side typed IPC helper (thin wrappers over window.electronAPI)
|   +-- App.tsx                 # Root: MigrationGate -> AuthProvider -> AppContent
|   +-- electron.d.ts           # window.electronAPI TypeScript declarations
|   +-- index.css
|   +-- main.tsx                # React entry: ReactDOM.createRoot
|   +-- types.ts                # Core domain types (Material, Topic, Folder, ProfessorResponse, etc.)
+-- docs/
|   +-- AI_SYSTEM.md
|   +-- IN_APP_BROWSER_GUIDE.md
|   +-- PERFORMANCE_AND_RAM_GUIDE.md
|   +-- THEME_DESIGN_GUIDE.md
+-- package.json
+-- vite.config.ts
+-- vitest.config.ts
+-- tsconfig.json
+-- BUILDER_DEBRIEF.md
+-- ENGINEERING.md             <- you are here
+-- PROJECT_VISION.md
+-- design.md
+-- .env.example
```

### Representative Flow: Importing a PDF

```
User picks a file via Capture.tsx
  -> window.electronAPI.openFileDialog()         (preload: dialog:openFile)
  -> dialog.showOpenDialog()                     (main process)
  -> window.electronAPI.copyFileToLocal()        (preload: file:copyToLocal)
  -> check free disk space (check-disk-space)
  -> copy to userData/local-files/<uuid>_<name>
  -> window.electronAPI.hashFile() + getFileSize()
  -> ipcService.vault.capture() -> vault:capture IPC
  -> vaultHandlers.ts -> VaultService -> MaterialApplicationService
  -> SqliteMaterialRepository.create() -> INSERT INTO materials
  -> ingestionQueue.enqueue(materialId, localPath)
    -> INSERT INTO ingestion_queue (status=waiting)
    -> concept_index status = queued
    -> processNext() via setImmediate
      -> PDF.js text extraction + bounding boxes
      -> noise filtering + column detection + TOC guard
      -> RecursiveCharacterTextSplitter (chunkSize=512, overlap=64)
      -> EmbeddingService.embedBatch() [if RAG enabled]
      -> SqliteVectorRepository + document_chunks INSERT
      -> IPC push: professor:ingestionProgress -> renderer
  -> renderer local React state updated
```

---

## Section 4: Data Model

The runtime migration source is `electron/db/migrate.ts`. **The `.sql` files in `electron/db/migrations/` are reference copies only and are NOT executed by packaged builds.** Runtime migrations go to version 16.

**SQLite database location:** `app.getPath('userData')/corvovault.db`

**Connection PRAGMAs:** `foreign_keys = ON`, `journal_mode = WAL`, `synchronous = NORMAL`

### Schema Hierarchy

```
profiles
  +-- topics (FK: profile_id)
       +-- folders (FK: topic_id, profile_id)
            +-- materials (FK: folder_id, profile_id)
                 +-- material_notes (FK: material_id)
                 +-- video_progress (FK: material_id)
                 +-- document_chunks (FK: material_id)  <- AI indexing
                 +-- annotations (FK: material_id, chunk_id)
                 +-- pdf_bookmarks (FK: material_id)
                 +-- concept_index (FK: material_id)
                 +-- professor_sessions (FK: material_id)
                 +-- ingestion_queue (FK: material_id)
profiles
  +-- profile_settings
  +-- profile_stats
  +-- profile_theme
  +-- bookmarks
  +-- daily_usage
  +-- activity_log
  +-- browser_history
Global:
  +-- schema_migrations
  +-- db_meta
  +-- vec_chunk_map
  +-- vec_chunks (virtual, sqlite-vec)
  +-- materials_fts (virtual, FTS5)
  +-- concept_relationships
  +-- courses
  +-- domain_render_cache
  +-- ocr_cache
```

### Table Definitions

#### `schema_migrations`
| Column | Type | Notes |
|---|---|---|
| `version` | INTEGER PK | Migration version number |
| `filename` | TEXT NOT NULL | Migration filename reference |
| `applied_at` | INTEGER NOT NULL | Unix timestamp |

#### `profiles`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT NOT NULL | |
| `avatar_path` | TEXT | nullable |
| `created_at` | INTEGER NOT NULL | |
| `current` | INTEGER NOT NULL DEFAULT 0 | Migration 004. `1` = active profile |

#### `topics`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `name` | TEXT NOT NULL | |
| `created_at` | INTEGER NOT NULL | |

#### `folders`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `topic_id` | TEXT NOT NULL | FK -> topics(id) ON DELETE CASCADE |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `name` | TEXT NOT NULL | |
| `created_at` | INTEGER NOT NULL | |

#### `materials`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `folder_id` | TEXT NOT NULL | FK -> folders(id) ON DELETE CASCADE |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `box_type` | TEXT NOT NULL | `file`, `link`, `youtube`, `note` |
| `title` | TEXT | nullable |
| `url` | TEXT | nullable |
| `local_path` | TEXT | nullable — path under `userData/local-files/` |
| `storage_status` | TEXT NOT NULL DEFAULT `active` | `active`, `trashed`, `missing` |
| `file_hash` | TEXT | SHA-256 hex, computed on import |
| `file_size` | INTEGER | bytes |
| `trashed_at` | INTEGER | nullable Unix timestamp |
| `trash_path` | TEXT | nullable — Migration 002, path under `.trash/` |
| `created_at` | INTEGER NOT NULL | |

Indexes: `idx_materials_folder`, `idx_materials_profile_status`, `idx_materials_trashed` (partial, WHERE trashed_at IS NOT NULL)

#### `materials_fts`
Virtual FTS5 table over `title` and `url`. Maintained by INSERT/UPDATE/DELETE triggers. Does **not** index PDF text or note content.

#### `material_notes`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `material_id` | TEXT NOT NULL | FK -> materials(id) ON DELETE CASCADE |
| `content` | TEXT NOT NULL | |
| `created_at` | INTEGER NOT NULL | **WARNING:** No `updated_at` column — but renderer types expose one |

#### `video_progress`
| Column | Type | Notes |
|---|---|---|
| `material_id` | TEXT PK | FK -> materials(id) ON DELETE CASCADE |
| `current_time` | REAL NOT NULL DEFAULT 0 | |
| `duration` | REAL | nullable |
| `last_watched` | INTEGER NOT NULL | |

#### `bookmarks`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `url` | TEXT NOT NULL | |
| `title` | TEXT | nullable |
| `created_at` | INTEGER NOT NULL | |

#### `daily_usage`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `date` | TEXT NOT NULL | |
| `time` | TEXT NOT NULL | |
| `app_name` | TEXT NOT NULL | |
| `app_package` | TEXT | nullable |
| `app_category` | TEXT | nullable |
| `minutes` | INTEGER NOT NULL | |
| `source` | TEXT NOT NULL DEFAULT `mobile` | **WARNING:** Default is `mobile` — designed for a companion app that does not exist yet |
| `device_id` | TEXT | nullable |
| `received_at` | INTEGER NOT NULL | |

Indexes: `idx_usage_profile_date`, `idx_usage_app`

**WARNING: Nothing writes to this table. Dashboard charts show zero data.**

#### `activity_log`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `action` | TEXT NOT NULL | |
| `metadata` | TEXT | nullable JSON |
| `created_at` | INTEGER NOT NULL | |

Index: `idx_activity_date`

#### `profile_settings`
| Column | Type | Notes |
|---|---|---|
| `profile_id` | TEXT PK | FK -> profiles(id) ON DELETE CASCADE |
| `data` | TEXT NOT NULL DEFAULT `{}` | JSON blob for all settings (study target, focus time, AI model, etc.) |
| `updated_at` | INTEGER NOT NULL | |

#### `profile_stats`
| Column | Type | Notes |
|---|---|---|
| `profile_id` | TEXT PK | FK -> profiles(id) ON DELETE CASCADE |
| `data` | TEXT NOT NULL DEFAULT `{}` | JSON blob |
| `updated_at` | INTEGER NOT NULL | |

#### `profile_theme`
| Column | Type | Notes |
|---|---|---|
| `profile_id` | TEXT PK | FK -> profiles(id) ON DELETE CASCADE |
| `theme_data` | TEXT NOT NULL DEFAULT `{}` | CSS variable map JSON |
| `overrides_data` | TEXT NOT NULL DEFAULT `{}` | User CSS override JSON |
| `updated_at` | INTEGER NOT NULL | |

#### `document_chunks`
| Column | Type | Notes |
|---|---|---|
| `chunk_id` | TEXT PK | |
| `material_id` | TEXT NOT NULL | FK -> materials(id) ON DELETE CASCADE |
| `page` | INTEGER NOT NULL | |
| `section` | TEXT | nullable |
| `chunk_type` | TEXT NOT NULL | `heading`, `paragraph`, `equation`, `caption`, `list_item` |
| `text` | TEXT NOT NULL | Cleaned text for BM25 search |
| `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h` | REAL | Normalized [0..1] bounding box relative to page |
| `embedding` | BLOB | Float32Array, 384 dimensions (1,536 bytes). nullable if RAG disabled |
| `chunk_order` | INTEGER NOT NULL | |
| `created_at` | INTEGER NOT NULL | |
| `chapter_id` | TEXT | Migration 008. Slug like `chapter_2` |
| `raw_text` | TEXT | Migration 008. Verbatim text for LLM prompts |
| `parent_summary_id` | TEXT | Migration 008. Future parent-child chunking |
| `is_toc` | INTEGER NOT NULL DEFAULT 0 | Migration 010. Flag to exclude TOC from retrieval |

Indexes: `idx_chunks_material`, `idx_chunks_page`, `idx_chunks_chapter`, `idx_chunks_is_toc`

#### `concept_index`
| Column | Type | Notes |
|---|---|---|
| `material_id` | TEXT PK | FK -> materials(id) ON DELETE CASCADE |
| `index_json` | TEXT NOT NULL DEFAULT `{}` | Document concept map JSON |
| `status` | TEXT NOT NULL DEFAULT `not_started` | `not_started`, `queued`, `processing`, `ready`, `failed` |
| `error_message` | TEXT | nullable |
| `total_chunks` | INTEGER DEFAULT 0 | |
| `created_at` | INTEGER NOT NULL | |
| `updated_at` | INTEGER NOT NULL | |

#### `professor_sessions`
| Column | Type | Notes |
|---|---|---|
| `session_id` | TEXT PK | |
| `material_id` | TEXT NOT NULL | FK -> materials(id) ON DELETE CASCADE |
| `conversation_json` | TEXT NOT NULL DEFAULT `[]` | Message history |
| `student_model_json` | TEXT NOT NULL DEFAULT `{}` | What student understands/is confused about |
| `agenda_json` | TEXT NOT NULL DEFAULT `[]` | Teaching agenda |
| `board_state_json` | TEXT NOT NULL DEFAULT `null` | Blackboard canvas snapshot |
| `last_page` | INTEGER NOT NULL DEFAULT 1 | |
| `created_at` | INTEGER NOT NULL | |
| `updated_at` | INTEGER NOT NULL | |

#### `ingestion_queue`
| Column | Type | Notes |
|---|---|---|
| `queue_id` | TEXT PK | |
| `material_id` | TEXT NOT NULL | FK -> materials(id) ON DELETE CASCADE |
| `local_path` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL DEFAULT `waiting` | `waiting`, `processing`, `done`, `failed` |
| `priority` | INTEGER NOT NULL DEFAULT 0 | Higher = sooner |
| `attempts` | INTEGER NOT NULL DEFAULT 0 | |
| `error_message` | TEXT | nullable |
| `queued_at` | INTEGER NOT NULL | |

Index: `idx_queue_status` on `(status, priority DESC, queued_at)`

#### `db_meta`
| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | |
| `value` | TEXT NOT NULL | |
| `updated_at` | INTEGER NOT NULL | |

Stores runtime flags like vector backfill status.

#### `vec_chunk_map`
| Column | Type | Notes |
|---|---|---|
| `rowid` | INTEGER PK | Maps to `vec_chunks` rowid |
| `chunk_id` | TEXT NOT NULL UNIQUE | FK -> `document_chunks(chunk_id)` ON DELETE CASCADE (after Migration 007) |
| `material_id` | TEXT NOT NULL | |

Index: `idx_vec_map_material`

#### `vec_chunks` (virtual — not in migrations)
Created at runtime in `SqliteVectorRepository.initialize()`:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[384])
```
Depends on `sqlite-vec` extension loading successfully.

#### `annotations`
| Column | Type | Notes |
|---|---|---|
| `annotation_id` | TEXT PK | |
| `material_id` | TEXT NOT NULL | FK -> materials(id) ON DELETE CASCADE |
| `chunk_id` | TEXT | nullable FK -> document_chunks(chunk_id) ON DELETE SET NULL |
| `page` | INTEGER NOT NULL | |
| `type` | TEXT NOT NULL | `highlight`, `underline`, `circle`, `arrow` |
| `target_text` | TEXT | nullable. Text content for fuzzy re-match |
| `color` | TEXT NOT NULL DEFAULT `orange` | |
| `callout` | TEXT | nullable label |
| `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h` | REAL | nullable geometry |
| `stroke_data` | TEXT | nullable freehand stroke JSON |
| `source` | TEXT NOT NULL DEFAULT `user` | `user` or `ai` |
| `created_at` | INTEGER NOT NULL | |

Index: `idx_annotations_material` on `(material_id, page)`

#### `pdf_bookmarks`
| Column | Type | Notes |
|---|---|---|
| `bookmark_id` | TEXT PK | |
| `material_id` | TEXT NOT NULL | FK -> materials(id) ON DELETE CASCADE |
| `page` | INTEGER NOT NULL | |
| `label` | TEXT NOT NULL | |
| `created_at` | INTEGER NOT NULL | |

Index: `idx_bookmarks_material`

#### `concept_relationships`
| Column | Type | Notes |
|---|---|---|
| `material_id` | TEXT (PK part 1) | FK -> materials(id) ON DELETE CASCADE |
| `parent_concept` | TEXT (PK part 2) | |
| `child_concept` | TEXT (PK part 3) | |
| `relationship_type` | TEXT NOT NULL DEFAULT `prerequisite` | |

Index: `idx_concept_relations_material`

#### `courses`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `title` | TEXT NOT NULL | |
| `provider` | TEXT NOT NULL | `coursera`, `mit`, `khan`, etc. |
| `providerCourseId` | TEXT NOT NULL | |
| `officialUrl` | TEXT NOT NULL | |
| `thumbnail` | TEXT | nullable |
| `description` | TEXT | nullable |
| `language` | TEXT | nullable |
| `duration` | TEXT | nullable |
| `isFree` | INTEGER NOT NULL DEFAULT 1 | |
| `rating` | REAL | nullable |
| `instructor` | TEXT | nullable |
| `university` | TEXT | nullable |
| `lastOpened` | INTEGER | nullable |
| `progress` | TEXT | nullable |
| `createdAt` | INTEGER NOT NULL | |
| `content` | TEXT | Migration 013. JSON blob for course items (videos, resources, etc.) |

Unique index: `idx_courses_provider_id` on `(provider, providerCourseId)`

#### `browser_history`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | FK -> profiles(id) ON DELETE CASCADE |
| `title` | TEXT | nullable |
| `url` | TEXT NOT NULL | |
| `created_at` | INTEGER NOT NULL | |

Index: `idx_browser_history_profile_date` on `(profile_id, created_at DESC)`

#### `domain_render_cache`
| Column | Type | Notes |
|---|---|---|
| `domain` | TEXT PK | |
| `render_type` | TEXT NOT NULL | Site-specific render mode override |
| `updated_at` | INTEGER NOT NULL | |

#### `ocr_cache`
| Column | Type | Notes |
|---|---|---|
| `material_id` | TEXT (PK part 1) | |
| `page_num` | INTEGER (PK part 2) | |
| `ocr_items` | TEXT NOT NULL | JSON array of OCR text items |
| `created_at` | INTEGER NOT NULL | |

Migration 016 (most recent). IPC handlers exist (`ocr:getCache`, `ocr:saveCache`). Not yet wired to OCR inference.

### Migration History

| Version | Filename | What It Does |
|---:|---|---|
| 1 | `001_initial.sql` | profiles, topics, folders, materials, notes, video_progress, bookmarks, daily_usage, activity_log, FTS5 virtual table, triggers, indexes |
| 2 | `002_add_trash_path.sql` | `materials.trash_path` |
| 3 | `003_profile_config.sql` | `profile_settings`, `profile_stats`, `profile_theme` |
| 4 | `004_profiles_current.sql` | `profiles.current` |
| 5 | `005_professor_document_map.sql` | `document_chunks`, `concept_index`, `professor_sessions`, `ingestion_queue`, indexes |
| 6 | `006_vec_infrastructure.sql` | `db_meta`, `vec_chunk_map` |
| 7 | `007_vec_chunk_map_fk.sql` | Rebuilds `vec_chunk_map` with FK to `document_chunks` (Fix B-01: Ghost Vectors) |
| 8 | `008_structural_columns.sql` | Adds `chapter_id`, `raw_text`, `parent_summary_id` to `document_chunks` |
| 9 | `009_annotations_table.sql` | `annotations`, `pdf_bookmarks` tables — moves from localStorage to SQLite |
| 10 | `010_is_toc_column.sql` | `document_chunks.is_toc` flag + index |
| 11 | `011_add_concept_relations.sql` | `concept_relationships` table |
| 12 | `012_add_courses.sql` | `courses` table |
| 13 | `013_add_course_content.sql` | `courses.content` JSON column |
| 14 | `014_add_browser_history.sql` | `browser_history` table |
| 15 | `015_add_domain_render_cache.sql` | `domain_render_cache` table |
| 16 | `016_add_ocr_cache.sql` | `ocr_cache` table |

### Other Persistent Storage

| Location | Contents |
|---|---|
| `userData/corvovault.db` | SQLite database |
| `userData/local-files/` | Imported files (PDF, DOCX, images, etc.) |
| `userData/local-files/.trash/` | Soft-deleted files awaiting purge |
| `userData/previews/` | Cached PDFs from DOCX/ODT conversion |
| `userData/ai-models/` | Downloaded ONNX transformer model cache |
| `userData/secrets_store.json` | OS-encrypted API keys (safeStorage) |
| `userData/pin_store.enc` | OS-encrypted PIN config |
| `userData/pin_config.json` | **WARNING:** Legacy/fallback plain PIN config if OS encryption unavailable |
| `userData/legacy-backup.json` | localStorage migration backup |
| `userData/migration_journal.json` | Legacy migration state |
| `localStorage` | Tab state, sidebar state, panel state, library UI state, browser prefs, annotation fallback |

---

## Section 5: Dev Environment Setup

Node.js version is not pinned in `package.json`. README says Node.js 18+. Given Electron 35, Vite 6, React 19, and `@types/node` ^22, use a current LTS Node (v20 or v22).

**This project is built for Windows.** Evidence: `resources/pandoc/pandoc.exe`, `CorvoVault.vbs`, PowerShell kill script. Electron Builder has macOS/Linux icon config, but these are not regularly tested.

```bash
# 1. Clone
git clone <repo-url>
cd corvovault  # note: workspace path may show as "study-in-center" in some paths

# 2. Install (postinstall rebuilds native modules + copies PDF.js worker)
npm install
# postinstall: electron-rebuild -f -w better-sqlite3,keytar,sqlite-vec
#              node scripts/copy-pdfjs-worker.js

# If native rebuild fails:
npm run electron:rebuild

# 3. Environment (optional -- keys are entered in app settings UI)
cp .env.example .env
```

**Dev commands:**

```bash
# Renderer only -- Vite at http://127.0.0.1:3000 (no Electron, no SQLite)
npm run dev

# Full desktop dev -- Vite + wait-on + tsc + electron-rebuild + electron
npm run electron:dev

# Type check (tsc --noEmit only, no ESLint)
npm run lint

# Unit tests
npm test

# Production renderer build only
npm run build

# Compile Electron TS + launch against current dist/
npm run electron:start
```

**There is no ESLint config.** `npm run lint` is `tsc --noEmit`.

---

## Section 6: Build and Distribution

```bash
npm run electron:build
# = vite build && tsc -p electron/tsconfig.json && electron-builder
```

**Outputs:**

- Renderer: `dist/`
- Electron main: `dist-electron/`
- Installer/artifacts: `release/`

**Electron Builder config (`package.json` -> `build`):**

- `appId`: `com.corvovault.app`
- `productName`: CorvoVault
- Windows: NSIS installer (`oneClick: false`, user-level install)
- Icons: `public/icon.ico` (Win), `public/icon.icns` (Mac), `public/icon.png` (Linux)
- Extra resource: `resources/pandoc` -> packaged as `pandoc/`
- Publish: GitHub provider `srkaran756/corvovault`

**Known build risks:**

- Native modules (`better-sqlite3`, `keytar`, `sqlite-vec`) must be rebuilt for Electron ABI. `postinstall` tries this.
- `pandoc.exe` is Windows-only; DOCX conversion will not work on Mac/Linux packages.
- SQL migrations are **embedded in TS strings** in `migrate.ts` — `.sql` files alone are NOT packaged by tsc.
- Auto-update configured for GitHub Releases but no code signing configured.

---

## Section 7: Architecture Decisions

**Decision: Local-first storage**

Core data lives in SQLite under `app.getPath('userData')`. Files live under `userData/local-files/`. API keys in OS-encrypted storage.

*Trade-off:* No server sync, no multi-device, no backup beyond what the user exports. Data loss depends on local disk.

*Status:* Core to the product. Some renderer UI state still leaks to `localStorage` (tabs, sidebar state, library UI state).

**Decision: Electron desktop (not a web app)**

The app needs local file import/copy, SQLite, native dialogs, bundled webview browser, OS encryption, Pandoc conversion, and local ONNX model files.

*Trade-off:* Native module rebuilds on every Electron version bump. Larger runtime. Platform-specific behavior. Windows-primary.

*Status:* Correct for the use case. Cross-platform support would need work.

**Decision: Renderer uses preload IPC bridge**

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Renderer calls `window.electronAPI.*`.

*Trade-off:* Every new capability requires updating preload. The exposed generic `invoke(channel, ...args)` weakens the boundary.

*Status:* Structurally correct. The generic invoke is a pragmatic escape hatch that should be narrowed over time.

**Decision: Service/Repository split for vault data**

`ServiceHost` wires `SqliteXxxRepository` -> `XxxApplicationService` -> `VaultService` facade. IPC handlers call the facade.

*Trade-off:* Still some logic directly in IPC handlers and `main.ts`. The split is incomplete.

*Status:* Good foundation. More consistent application of the pattern would eliminate remaining handler-level logic.

**Decision: SQL migrations embedded in TypeScript strings**

`tsc` does not copy `.sql` files into `dist-electron/`. Embedding in `migrate.ts` guarantees packaged builds can run migrations.

*Trade-off:* `.sql` reference files can drift from runtime SQL (and they have — runtime is at v16, folder README mentions only v1-4).

*Status:* Correct runtime approach. Reference files need discipline; either generate them from `migrate.ts` or delete them.

**Decision: Feature flag for RAG pipeline**

`FEATURE_FLAGS.ENABLE_RAG_PIPELINE = false` in `featureFlags.ts`. `isRAGEnabled()` checked in `EmbeddingService.embedBatch()` and throughout `ProfessorService`. Previously this was scattered `return true` hacks and uncaught errors. Refactored to a single source of truth.

*Trade-off:* The UI does not always communicate clearly to the user that AI is disabled. Silent degradation is better than crashes but worse than explicit UI state.

*Status:* Clean architecture win. Missing: visible disabled-state UI for the AI tutor.

**Decision: Local embeddings + optional remote LLMs**

`@xenova/transformers` runs `all-MiniLM-L6-v2` (quantized ONNX, ~22MB) locally for embeddings. Chat responses use user-provided API keys for Gemini, OpenAI, Anthropic, or OpenRouter.

*Trade-off:* Ingestion is CPU-bound. Model download on first use. Remote LLM quality and cost depend on user's provider.

*Status:* Architecturally sound for the privacy-first use case. Performance on low-end hardware needs monitoring.

**Decision: JSON text blobs for profile settings/stats/theme**

`profile_settings.data`, `profile_stats.data`, `profile_theme.theme_data` are TEXT JSON columns.

*Trade-off:* Bypasses SQL schema rigidity. New preference fields can be added without a migration. But: no SQL-level validation, no partial updates, read-modify-write required.

*Status:* Pragmatic. Works well for settings that evolve frequently. Would not use for data that needs to be queried or indexed.

**Decision: Two secret storage APIs (safeStorage + keytar)**

`SecretService` prefers Electron `safeStorage`; falls back to `keytar` when OS encryption is unavailable. Both coexist during migration.

*Trade-off:* Two code paths. keytar has its own native rebuild complexity.

*Status:* Reasonable migration approach. Phase B note exists in `secretService.ts`: remove keytar once production stability is confirmed.

**Decision: Pandoc + hidden BrowserWindow for DOCX preview**

DOCX -> Pandoc HTML -> hidden Electron window prints -> PDF -> cached preview -> PDF viewer.

*Trade-off:* Requires Windows `pandoc.exe`, a hidden window, timeouts, and preview cache management.

*Status:* Clever reuse of PDF viewer. Platform-specific. Fragile on edge cases.

**Decision: Custom `corvovault-file://` protocol for local files**

Registered as a privileged scheme with `standard: true`, `secure: true`, `stream: true`, `corsEnabled: true`. Serves files from disk with automatic decryption fallback.

*Security note:* The handler should enforce that all served paths are within `userData/local-files/`. Currently it checks existence but not containment.

---

## Section 8: Known Issues and Technical Debt

**1. Runtime migration docs out of sync.**
`migrate.ts` defines 16 migrations. `electron/db/migrations/README.md` documents only 1-4. A new contributor reading only the SQL folder misses 12 migrations worth of schema.
Fix: Generate reference `.sql` files from `migrate.ts`, or maintain them in lock-step.

**2. Generic IPC `invoke` weakens the preload security boundary.**
`preload.ts` exposes `invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)`. Event subscriptions are allowlisted (29 channels); invoke calls are not.
Risk: If renderer code is compromised, any registered IPC channel can be called with any payload.
Fix: Replace generic invoke with an explicit invoke allowlist.

**3. Most IPC payloads are unvalidated.**
Only `vault:searchMaterials` uses Zod. Handlers for `professor:saveSession`, `professor:saveAnnotation`, profile sync, settings save, theme save all accept `any`.
Fix: Add `shared/ipc/schemas.ts` entries for each handler and validate at the IPC boundary.

**4. Custom file protocol serves arbitrary existing paths.**
`corvovault-file://` handler does not enforce that the path is inside `userData/local-files/`. Any local path encoded as `corvovault-file://` may be readable from the renderer.
Fix: Apply `assertInsideUserData` guard to the protocol handler.

**5. PIN storage can fall back to plain JSON.**
If `safeStorage.isEncryptionAvailable()` returns false, `pin_config.json` is written in plain JSON with a warning logged. The user sees no UI warning.
Fix: Fail closed or show a visible warning before allowing fallback.

**6. Annotation highlight geometry loss.**
`usePdfSelection.ts` saves `target_text` but not rectangle geometry for text highlights. Rectangles are rebuilt by fuzzy text matching on reload. If text appears multiple times on a page, highlights can appear in the wrong place.
Fix: Persist normalized bounding rectangles when available. Use text matching only as fallback.

**7. Annotation state split between SQLite and localStorage.**
`usePdfSelection.ts`, `usePdfBookmarks.ts`, and `CustomPdfViewer.tsx` still have localStorage fallback paths for migration/failure cases. Annotation state can live in two places simultaneously during failures.
Fix: Once migration confidence is high, make SQLite the only write path and remove localStorage annotation code.

**8. PDF selection engine is unfinished.**
`TODO.md` lists unchecked work: selection performance, visual ordering, copy formatting, highlight rectangle merging. `CustomPdfViewer.tsx` line 1998 has a cleanup comment about a temporary row key.
Fix: Complete the TODO checklist. Add PDF fixture tests for complex multi-column layouts.

**9. Errors swallowed into null/false/empty.**
File deletion returns `false` on error. YouTube info returns `null`. Several localStorage JSON parses have empty catch blocks.
Fix: Return typed `IpcResult<T>` envelopes (already designed in `shared/ipc/envelope.ts`) for all handlers. Show user-visible errors for data-affecting operations.

**10. `electron/main.ts` is too broad.**
`main.ts` owns: window creation, security policies, ad blocker setup, protocol handler, IPC registration for dialogs/files/web/updater, download context menu in webviews, DB initialization, service host creation, and app lifecycle.
Fix: Extract protocol, updater, web-search, export, and download context menu into focused handler files or services with their own tests.

**11. Test schemas sometimes do not match production.**
`VaultPurgeApplicationService.test.ts` includes a `topic_id` column on materials that production `materials` does not have. Handwritten test schemas can drift from `migrate.ts`.
Fix: Call `runMigrations()` on an in-memory DB in tests, or centralize test schema creation.

**12. Scratch artifacts at repo root.**
`test_output.html`, `test_output2.html`, `test_db.js`, `crowvault.db` (note: not `corvovault.db`) at repo root.
Fix: Move to `scratch/` or `.gitignore`.

**13. SearXNG UI label vs. DuckDuckGo implementation.**
`preload.ts` exposes `searxngSearch`. The implementation in `webHandlers.ts` ignores the custom instance and scrapes DuckDuckGo HTML.
Fix: Implement actual SearXNG support, or rename the feature to match the implementation.

**14. Dashboard charts show zero data.**
`daily_usage` table is never written. Dashboard heatmap and pie chart render zeros.
Fix: Write session-minutes to `daily_usage` on study activity. Set `lastFolderId` on folder selection.

**15. `courseHandlers.ts` violates the architectural layering.**
IPC handler performs HTTP scraping, defines the 60-course catalog array inline, manages thumbnail cache, and contains all course content extraction logic.
Fix: Extract catalog and scraping into `courseService.ts`. Keep the handler thin.

**16. `material_notes.updated_at` column does not exist.**
`src/types.ts` exposes `MaterialNote.updatedAt`. The `material_notes` table has no `updated_at` column. Will silently return `undefined`.
Fix: Add `updated_at` in a new migration, or remove `updatedAt` from the TypeScript type.

---

## Section 9: Testing

```bash
npm test
# vitest run -- reads vitest.config.ts
```

Test files:

| File | What It Tests |
|---|---|
| `shared/ipc/schemas.test.ts` | Zod schema validation for searchMaterials |
| `src/hooks/useActivityTimer.test.ts` | Activity timer hook logic |
| `electron/application/VaultPurgeApplicationService.test.ts` | Vault purge business logic |
| `electron/repositories/sqlite/SqliteFolderRepository.test.ts` | Folder CRUD in SQLite |
| `electron/repositories/sqlite/SqliteMaterialRepository.test.ts` | Material CRUD in SQLite |
| `electron/repositories/sqlite/SqliteVectorRepository.test.ts` | Vector store operations |
| `electron/services/ingestionQueue.test.ts` | Queue enqueue/resume/processing logic |
| `electron/services/professorService.test.ts` | BM25 + retrieval logic |
| `electron/services/ragEvaluation.test.ts` | RAG retrieval quality evaluation |

No tests for: End-to-end Electron flows, renderer components, file import/trash/restore, DOCX conversion, browser behavior, packaged builds.

Most critical areas to add tests:

1. `runMigrations()` against a blank DB and against a DB at each historical version
2. IPC validation for settings, annotations, professor sessions
3. File import/trash/restore/purge (disk state + SQLite state must stay in sync)
4. PDF annotation persistence and reload (text matching across reload)
5. Ingestion queue failure/retry with real PDFs

---

## Section 10: Environment Variables and Configuration

`.env.example` variables (all optional):

| Variable | What It Controls |
|---|---|
| `VITE_SUPABASE_URL` | Optional Supabase URL for settings test |
| `VITE_SUPABASE_ANON_KEY` | Optional Supabase anon key |
| `VITE_GOOGLE_DRIVE_CLIENT_ID` | Optional Google Drive client ID |
| `VITE_GOOGLE_DRIVE_FOLDER_ID` | Optional Google Drive folder ID |

Runtime API keys (Gemini, OpenAI, Anthropic, OpenRouter) are entered in the app Settings UI and stored via `SecretService` (OS-encrypted). They are never environment variables.

---

## Section 11: Things a Maintainer Must Know

1. **`migrate.ts` is the schema source of truth.** Do not add only a `.sql` file — the packaged app will not run it.
2. **The repo is mid-migration from localStorage to SQLite.** Core vault data is SQLite. Tab state, sidebar state, library UI state, and annotation fallbacks still use `localStorage`.
3. **`npm run dev` is not the desktop app.** Use `npm run electron:dev`. `npm run dev` is renderer-only without IPC.
4. **Native module rebuilds matter.** After `npm install` or Electron version bump, run `npm run electron:rebuild` if you see ABI errors.
5. **`resources/pandoc/pandoc.exe` is required for DOCX preview.** Windows-only.
6. **AI is two separate layers:** local ingestion/embedding in Electron main process, and remote LLM calls from the React renderer using user API keys.
7. **PDF viewer is custom and complex.** `CustomPdfViewer.tsx`, `usePdfSelection.ts`, and `pdfSelectionEngine.ts` are tightly coupled.
8. **`ServiceHost` is the composition root.** Start there when tracing main-process features.
9. **`electron/main.ts` owns too much.** File import, protocol serving, updater, window behavior, ad blocker setup, download context menu, and lifecycle all live there. Be careful.
10. **The browser uses a separate Electron `persist:browser` partition.** Clearing browser cache does not affect the app renderer's `localStorage`.
11. **`corvovault-file://` is a custom protocol.** Path containment validation should be added.
12. **Some names are inconsistent.** Package name is `corvovault`. Root DB file is `crowvault.db` (typo). Workspace path shows `study-in-center` in some paths.
13. **`featureFlags.ts` is the single switch for AI.** Set `ENABLE_RAG_PIPELINE: true` to enable local embeddings + vector search. Everything checks `isRAGEnabled()`.

---

## Section 12: Glossary

| Term | Meaning |
|---|---|
| Profile | A local user identity. Scopes topics, folders, settings, theme, stats, and materials. |
| Topic | Top-level vault grouping under a profile (e.g., "Physics"). |
| Folder | Grouping under a topic (e.g., "Quantum Mechanics"). Materials belong to folders. |
| Material | One saved item: file, link, YouTube video, or note. |
| Vault | The local collection of topics, folders, materials, files, and metadata. |
| `userData` | Electron's per-user app data directory. SQLite DB and imported files live here. |
| Ingestion | Background extraction, chunking, embedding, and indexing of PDFs for AI. |
| Concept index | JSON state in SQLite describing document map/status for a material. |
| Professor | Code name for the AI tutor/RAG feature. |
| RAG | Retrieval-Augmented Generation: retrieve document chunks, then ask LLM to answer using them. |
| TOC | Table of contents. Detected to exclude front matter from retrieval results. |
| RRF | Reciprocal Rank Fusion: merges BM25 and vector search rankings. `1/(60+rank_BM25) + 1/(60+rank_vec)`. |
| Ignoto | Code name for the privacy-mode browser with local proxy + DoH + tracker blocking. |
| ServiceHost | The composition root class that wires all repos, services, and queues together. |
| `IpcResult<T>` | The typed envelope `{ success: boolean, data?: T, error?: string }` defined in `shared/ipc/envelope.ts`. |

---

# Beginner Learning Guide

This section builds a mental model before you edit code.

## The Big Picture

CorvoVault has two halves:

1. **Renderer** — the visible app. React UI in `src/`.
2. **Main process** — the OS side. Electron code in `electron/`.

The renderer cannot read files, write SQLite, or call OS APIs directly. It asks the main process through IPC.

```
React UI
  -> window.electronAPI (preload bridge)
  -> ipcMain.handle (main process)
  -> service / repository
  -> SQLite or filesystem
  -> response back to React
```

**If you remember one thing: the UI asks, the main process does.**

## The Data Shape

```
Profile
  -> Topic
    -> Folder
      -> Material (file / link / YouTube / note)
        -> Notes, annotations, bookmarks, AI chunks
```

Example:

```
Profile: Default User
  Topic: Physics
    Folder: Quantum Mechanics
      Material: chapter-1.pdf
```

## How a Database Write Happens — Full Stack

Creating a topic:

```
User clicks "Add Topic"
  -> src/components/Library.tsx calls addTopic()
  -> src/hooks/useLocalData.ts useTopics().addTopic()
  -> ipcService.topics.create(profileId, name)
  -> window.electronAPI.invoke('topics:create', profileId, name)
  -> electron/ipcHandlers/vaultHandlers.ts receives 'topics:create'
  -> serviceHost.vault.createTopic(profileId, name)
  -> TopicApplicationService.createTopic()
  -> SqliteTopicRepository.create()
  -> INSERT INTO topics ...
  -> React local state updated
  -> IPC push 'topic:created' -> useTopics() re-fetches
```

Files to read in that order:

1. `src/components/Library.tsx`
2. `src/hooks/useLocalData.ts`
3. `src/services/ipcService.ts`
4. `electron/ipcHandlers/vaultHandlers.ts`
5. `electron/services/vaultService.ts`
6. `electron/application/TopicApplicationService.ts`
7. `electron/repositories/sqlite/SqliteTopicRepository.ts`

## How File Storage Works

Database = metadata. Files = on disk.

```
Import PDF: C:\Users\...\Downloads\book.pdf
  -> copied to: userData\local-files\<uuid>_book.pdf
  -> DB row: materials.local_path = copied path
             materials.file_hash = SHA-256 hex
             materials.file_size = bytes
```

Why copy? The app owns the copy. The original can move or be deleted without breaking the vault.

## How the PDF Viewer Works

Five key files:

- `usePdfDocument.ts` — loads PDF.js, reads file via IPC as base64
- `usePdfSelection.ts` — custom text selection + highlight engine
- `usePdfAnnotations.ts` — load/save annotations via IPC
- `usePdfBookmarks.ts` — load/save bookmarks via IPC
- `pdfSelectionEngine.ts` — the actual selection algorithm

Why custom selection? Browser selection cannot handle: rotated text, split words, multi-column layouts, selection spanning pages.

## How the AI Tutor Works (When Enabled)

Four phases:

1. **Ingestion** (background, Electron main): PDF -> text extract + bounding boxes -> chunk (512 chars) -> embed (384-dim vector) -> SQLite
2. **Retrieval** (when user asks): query -> BM25 search + vector cosine -> RRF merge -> top-K chunks
3. **Agent loop** (renderer, remote LLM): LLM gets chunks, calls tools (`get_page`, `search_chunks`, `list_topics`) up to 8 iterations
4. **Output** (renderer): structured JSON with `speech`, `pdf_annotations`, `board_actions`, `navigate_to_page`

Current state: `ENABLE_RAG_PIPELINE = false`. Step 1 skips embedding generation. Steps 2-4 fall back to BM25-only search.

## The Startup Sequence

```
Electron main:
  app.whenReady()
  -> createWindow()          <- window appears immediately
  -> getDb() + runMigrations()
  -> new ServiceHost()       <- wires all repos + services
  -> ingestionQueue.resumeOnStartup()
  -> register protocol + IPC handlers
  -> loadWindowContent()     <- navigate to Vite dev server or built index.html

React renderer:
  ReactDOM.createRoot() -> <App>
  -> <MigrationGate>         <- checks localStorage->SQLite migration status
  -> <AuthProvider>          <- loads profiles + current profile + settings
  -> PIN check
  -> <TabProvider>           <- restores workspace tabs from localStorage
  -> <AppShell>              <- renders the full UI
```

## Suggested Learning Order

1. `README.md` — product summary
2. `package.json` — commands and dependencies
3. `src/App.tsx` — renderer startup
4. `electron/main.ts` — main startup and IPC registration
5. `electron/preload.ts` — the bridge between worlds
6. `src/services/ipcService.ts` — renderer IPC helpers
7. `electron/db/migrate.ts` — database schema
8. `electron/ServiceHost.ts` — service wiring
9. `src/hooks/useLocalData.ts` — UI data operations
10. `electron/services/vaultService.ts` — vault business logic
11. `src/components/tabs/CustomPdfViewer.tsx` — after understanding PDF basics
12. `electron/services/ingestionQueue.ts` + `professorService.ts` — RAG pipeline
13. `src/components/tabs/AiTutorPanel.tsx` — the final AI UI flow

## Common Beginner Mistakes

| Mistake | Reality |
|---|---|
| Changing a TypeScript type assuming DB changed | Schema changes must be added to `migrate.ts` |
| Changing a `.sql` file assuming it runs | Runtime migrations are in `migrate.ts` only |
| Reading `localStorage` as the main data store | Core data is SQLite; localStorage is UI state + fallback |
| Calling Node APIs from React | Must go through `window.electronAPI` |
| Thinking AI reads the whole PDF every time | PDF is pre-indexed into chunks; only relevant chunks retrieved |
| Thinking embeddings and LLM are the same thing | Embeddings are local numeric vectors for search; LLM answers come from remote API |
| Thinking adding a material only touches SQLite | Also triggers file copy, hashing, and ingestion queue entry |

---

# Heavy Engineering Reference

## RAG Pipeline: Architecture and Mathematics

### 1. Embedding Model Constraints

The system uses `Xenova/all-MiniLM-L6-v2` (quantized ONNX, ~22MB):

- **Embedding dimension:** 384
- **Maximum input:** 256 tokens
- **Token-to-char ratio:** ~1 token = 4 characters (English prose)

Max safe chars = 256 tokens x 3 chars/token (conservative) = 768 chars  
`CHUNK_MAX_CHARS = 768` (enforced cap in `ingestionQueue.ts`)

### 2. Chunking Configuration

```typescript
// From ingestionQueue.ts
const CHUNK_SIZE = 512;     // characters, ~128 tokens
const CHUNK_OVERLAP = 64;   // characters, ~16 tokens
const CHUNK_MAX_CHARS = 768; // hard cap (256 tokens at 3 chars/token)
const CHUNK_MIN_CHARS = 15;  // discard noise fragments

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,
  chunkOverlap: 64,
  separators: ['\n\n', '\n', '. ', ' '],
});
```

Effective step size: 512 - 64 = 448 chars/chunk

### 3. Storage Footprint per Chunk

| Component | Size |
|---|---|
| Text content | ~750 bytes (UTF-8) |
| Vector embedding | 384 x 4 bytes = 1,536 bytes |
| DB metadata + shadow indexes | ~1,750 bytes |
| **Total** | **~4.0 KB per chunk** |

For a 300-page textbook:
- 3,000 chars/page / 448 chars/step ~= 6.7 prose chunks/page
- ~8 chunks/page (including headings, equations, captions)
- 300 x 8 = 2,400 total chunks
- 2,400 x 4 KB = **~9.6 MB total** (well within SQLite performance range)

### 4. Hybrid Retrieval: BM25 + RRF + Vector

BM25 search:
```sql
SELECT chunk_id, rank FROM document_chunks WHERE materials_fts MATCH ?
  AND material_id = ? AND is_toc = 0
ORDER BY rank LIMIT 20
```

Vector search (cosine via sqlite-vec):
```sql
SELECT vec_map.chunk_id, distance
FROM vec_chunks
JOIN vec_chunk_map vec_map ON vec_chunks.rowid = vec_map.rowid
WHERE embedding MATCH ? AND k = 20
  AND vec_map.material_id = ?
```

Reciprocal Rank Fusion:
```
RRF_Score = 1/(60 + rank_BM25) + 1/(60 + rank_vector)
```

Metadata boosts:
- Chapter match boost if chunk's `chapter_id` matches query's target chapter
- Page proximity boost if chunk's `page` is within +/-2 of current viewer page

### 5. Retrieval Context Window Efficiency

| Config | Chunk Size | K | Context Tokens | Retrieval Diversity |
|---|---|---|---|---|
| Large chunks | 2048 chars (~512 tok) | 4 | 2,048 tokens | 4 document locations |
| **Current (selected)** | **512 chars (~128 tok)** | **8** | **1,024 tokens** | **8 document locations** |

The current config doubles retrieval diversity at half the token cost.

### 6. Intent Classification

`ProfessorService.classifyAndRetrieve()` detects query intent before retrieval:

| Intent | Detection | Retrieval Strategy |
|---|---|---|
| `PAGE_CONTEXT` | No clear topic keyword | Chunks within +/-2 pages of current viewer page |
| `CHAPTER_SUMMARY` | "chapter X", "section Y" | Chunks with matching `chapter_id` |
| `COMPARISON` | Contains "vs", "compare X and Y" | Dual parallel lookups for each side |
| `FACT_LOOKUP` | Short factual query | Global BM25 + vector lookup |
| `GENERAL_SEMANTIC` | Default | Standard hybrid BM25 + vector |

### 7. Agentic Tool Loop

Rather than a single-shot RAG call, the system runs an iterative research cycle:

```
System prompt + page context + conversation history -> LLM
  LLM evaluates: "Do I have enough context?"
  If not -> returns tool calls:
    search_chunks(query)       -> chunk IDs/pages (not text)
    get_page(page_number)      -> full verbatim page text
    get_page_range(start, end) -> multi-page text
    get_topic(name)            -> all chunks for a concept
    get_section(title)         -> heading section text
    get_chapter(chapter_id)    -> full chapter chunks
    list_topics()              -> document outline
    list_sections()            -> all headings
  Main process executes tools -> appends results
  Loop repeats up to 8 iterations
  Final answer via professor_response tool call
```

Known failure modes:

- Models (especially smaller OpenRouter models) ignore structured schemas or fail to call tools
- LLM hallucinates page numbers if chapter index is polluted
- Context overflow on complex cross-page queries
- Fallback: if model returns no valid JSON, raw text is wrapped as `{ speech: text }`

### 8. Structured Output Schema

```json
{
  "thinking": "inner monologue (optional, not shown to user)",
  "speech": "teaching response (markdown)",
  "pdf_annotations": [
    {
      "type": "highlight",
      "page": 145,
      "targetText": "verbatim text to highlight",
      "color": "orange"
    }
  ],
  "board_actions": [
    {
      "tool": "chalk",
      "content": "formula or sketch",
      "position": { "x": 0.5, "y": 0.5 },
      "style": { "color": "white", "size": 24 },
      "timing": 500
    }
  ],
  "navigate_to_page": 145,
  "agenda_update": ["next topic"],
  "student_model_delta": {
    "now_understood": ["concept A"],
    "now_confused": ["concept B"]
  },
  "suggested_follow_up": "leading question for Socratic guidance"
}
```

---

## Security Architecture

### Electron Security Settings

```typescript
webPreferences: {
  contextIsolation: true,     // renderer cannot access Node globals
  nodeIntegration: false,     // renderer has no require()
  sandbox: true,              // OS-level sandbox isolation
  webSecurity: true,          // same-origin policy enforced
  allowRunningInsecureContent: false,
}
```

### Navigation Guard

On `will-navigate`, only the app origin (Vite dev server in dev, `file://` in prod) is allowed. All other navigations are blocked.

### IPC Event Allowlist

`preload.ts` allowlists 29 channels for event subscription. Unknown channels are blocked.

### Secret Storage Chain

1. Electron `safeStorage.encryptString()` — OS-backed encryption (Keychain/DPAPI/libsecret) -> stored as base64 in `userData/secrets_store.json`
2. If `safeStorage` unavailable -> `keytar` (native credential store)
3. PIN config: -> `safeStorage` -> `userData/pin_store.enc` / fallback -> `userData/pin_config.json` (**WARNING:** plain JSON, logged warning)

### Deep Ignoto Privacy Proxy

`ignotoProxy.ts` — zero external dependencies, built on Node.js built-ins:

1. **DNS-over-HTTPS:** Resolves hostnames via Cloudflare 1.1.1.1 — ISP DNS never sees queries
2. **Tracker blocklist:** ~60+ domains blocked at network level
3. **Header stripping:** Removes 20+ fingerprinting headers from HTTP requests
4. **User-Agent spoofing:** Generic UA for HTTP requests
5. **HTTPS tunneling:** Transparent CONNECT tunnel — TLS content not decrypted
6. **Header stripping for HTTPS:** Done via Electron `session.webRequest` interceptors in `ignotoHandlers.ts`

---

## Section 13: How AI Agent Was Used to Build This — Tactical vs. Strategic

> This section is for the solo builder who used an AI coding agent to construct most of this codebase. It is written as an honest account of where that was powerful, where it was dangerous, and what it reveals about a new kind of engineering skill.

### The New Skill: AI-Augmented Solo Building

Building CorvoVault with an AI agent is not the same as writing code manually. It requires a different mental model. The builder here functions as a **technical director**, not a line-code author. The questions shift from "how do I write this function?" to:

- What should this system do?
- Where should boundaries be drawn?
- Is what the agent produced correct, or just plausible?
- What is the agent good at vs. what does it miss?

This is a **real engineering skill**, and it compounds with traditional engineering knowledge. The more you know about design principles, the better your prompts, the better your review, and the better the output.

### Where the Builder Was Strategic

Strategic = making durable architectural decisions that shape the system for months, not days.

**1. The Repository Pattern Was a Strategic Choice**

The cleanest architectural decision in this codebase is the separation of:

```
SqliteXxxRepository -> XxxApplicationService -> VaultService (facade) -> IPC handlers
```

This was not accidental — it required the builder to specify the layering explicitly and then hold the line when the agent wanted to shortcut it (as it does in `courseHandlers.ts`).

The principle: *Separation of Concerns* (Robert Martin). Each layer should have one reason to change. SQLite repositories change when query patterns change. Application services change when business rules change. IPC handlers change when the protocol changes. They are independent.

**2. SQLite WAL Mode + Migrations Were Strategic**

Choosing `journal_mode = WAL`, `synchronous = NORMAL`, and embedding migrations as idempotent versioned steps are durable decisions. WAL mode allows concurrent reads during writes. Idempotent migrations allow safe reruns on partially-applied databases. The migration runner even guards for `hasColumn()` before running `ALTER TABLE`.

The principle: "Leave the campsite better than you found it" — clean up after you discover a defect, and document why.

**3. The Feature Flag Was a Strategic Refactor**

Migrating from scattered `return true` hacks and uncaught error throws to a centralized `FEATURE_FLAGS.ENABLE_RAG_PIPELINE` in `featureFlags.ts` was a strategic decision. The system behavior is predictable and controllable from one place.

Founder lens: A feature flag is also a product decision. It lets you ship the architecture without shipping the experience. The AI tutor backend is complete, tested, and ready. The product experience is not ready. The flag separates them cleanly.

The principle: *Open/Closed Principle* — open for extension (turn on RAG) without requiring modification of each caller.

**4. The `corvovault-file://` Custom Protocol Was Strategic**

Designing a custom privileged scheme that serves local files with decryption support, MIME type detection, and Windows path normalization required knowing what Electron can and cannot do with standard protocols.

### Where the Builder Was Tactical

Tactical = moving fast on a specific feature, sometimes at the cost of consistency. This is not bad — it is survival for a solo builder. But it must be recognized as debt.

**1. `courseHandlers.ts` — Tactical Blowout**

~57KB IPC handler that contains an HTTP scraper, a 60-course catalog array, thumbnail caching logic, and course content extraction. This violates every architectural principle the rest of the codebase follows.

Why it happened: The agent was asked to "make it work," and it generated everything in one file because that is the fastest path.

The lesson: **The agent is optimized to generate something that works. It is not optimized for architectural consistency. The builder must review every generated file and ask: Does this belong here?**

**2. `any` Types at the IPC Boundary — Tactical Escape Hatch**

Every professor handler: `session: any`, `annotation: any`. The shared `ipc/envelope.ts` and `schemas.ts` exist — but only one handler uses them.

Why it happened: The agent generated typed-looking code. The builder accepted it. TypeScript did not complain because the generic `invoke(channel, ...args)` returns `Promise<any>`.

The principle: *"Parse, Don't Validate"* (Alexis King). Transform input at the boundary into typed structures. Zod + `IpcResult<T>` already exist here — they need to be applied consistently.

**3. Swallowed Errors — Tactical Silence**

File deletion returning `false`. YouTube info returning `null`. Empty catch blocks in DOCX preview cleanup. These keep the UI running but hide root causes.

What a senior engineer knows: **Every swallowed error is a future debugging session where you have no information.**

**4. localStorage for Tab State — Tactical Persistence**

`TabContext.tsx` persists tabs, active tab, sidebar state, and panel state to `localStorage` with profile-scoped keys. Fast to implement, works well in practice. But workspace state is not backed up by export, not profile-migrated cleanly, and creates another storage location to reason about.

The lesson: localStorage is fine for ephemeral UI state. It becomes debt when it stores data that should be durable or migratable.

### Technical Priorities & Architecture Roadmap

1. **Maintain IPC Boundary Validation**: Progressively migrate remaining `any`-typed IPC handlers to Zod schemas using `shared/ipc/schemas.ts`.
2. **Decompose `courseHandlers.ts`**: Refactor the catalog data and HTML extraction routines into application services.
3. **Refine RAG Subsystem UI**: Improve model initialization loading states and offline capabilities when `isRAGEnabled()` is active.
4. **Wire Session Analytics**: Connect renderer activity logs to the SQLite activity repositories for dashboard metric visualizations.

### Architectural Decision Map

| Decision | Type | Quality | Action |
|---|---|---|---|
| Repository/service/handler layering | Strategic | Excellent | Maintain separation |
| WAL mode + atomic migrations | Strategic | Excellent | Maintain |
| `featureFlags.ts` single switch | Strategic | Good | Centralized control |
| `corvovault-file://` custom protocol | Strategic | Good | Retain path containment guards |
| Custom PDF selection engine | Strategic | Functional | Complete coordinate edge-case handling |
| Hybrid BM25 + RRF + vector retrieval | Strategic | Excellent | Enable via feature flag |
| JSON blobs for settings/stats/theme | Tactical | Acceptable | Retain for flexible settings schemas |
| Inline SQL in `migrate.ts` | Tactical | Necessary | Keep runtime inline; maintain `.sql` reference files |
| Zod schemas at IPC boundary | Tactical | In progress | Expand schema coverage across handlers |
| Monolithic `courseHandlers.ts` | Tactical | Technical Debt | Extract extraction logic to service layer |
| localStorage for tab state | Tactical | Acceptable | Ephemeral state; consider SQLite backup |


---

## Section 14: Software Design Principles Applied and Violated

### Principles Applied Well

**Single Responsibility Principle (SRP)**

- `SqliteTopicRepository` only knows SQL for topics
- `TopicApplicationService` only contains topic business logic
- `ThemeService` only manages theme persistence
- `IngestionQueue` only manages the background PDF processing queue
- Each IPC handler file covers one domain (vault, settings, secrets, professor, etc.)

**Open/Closed Principle (OCP)**

- `VectorRepository` interface: swap sqlite-vec for another vector store without touching retrieval logic
- `MaterialRepository` interface: swap SQLite for another store without touching application services
- `featureFlags.ts`: enable RAG without modifying every caller

**Interface Segregation (ISP)**

- `MaterialRepository`, `TopicRepository`, `FolderRepository` are separate interfaces
- `VaultService` is a facade that does not expose everything

**Dependency Inversion (DIP)**

- `ProfessorService` receives a `VectorRepository` interface, not a `SqliteVectorRepository` concrete
- Application services receive repository interfaces, not SQLite implementations
- `ServiceHost` is the only place that knows concrete implementations

**Don't Repeat Yourself (DRY)**

- Migration runner is a loop — adding a migration is one array entry
- `ipcService.ts` is the single place that maps all IPC channels to typed renderer helpers
- `isRAGEnabled()` called consistently instead of repeating the feature flag check

**Fail Fast (defensive programming)**

- Migration runner uses `hasColumn()` guards before `ALTER TABLE`
- `ingestionQueue.resumeOnStartup()` resets stuck `processing` jobs to `waiting`
- `ServiceHost.cleanCorruptedIngestions()` detects and clears noisy concept indexes at startup

### Principles Violated (Worth Knowing)

**SRP violated: `courseHandlers.ts`**
IPC handler + HTTP scraper + catalog definition + thumbnail cache = 4 responsibilities in one file.

**SRP violated: `electron/main.ts`**
Window creation + security policy + protocol handler + download context menu + ad blocker + DB init + service wiring + IPC registration + lifecycle = 10 responsibilities.

**OCP violated: hardcoded 60-course catalog**
The catalog is an inline array in `courseHandlers.ts`. Adding a provider requires editing the handler. Should be data-driven (config file or DB-seeded).

**DRY violated: localStorage annotation fallbacks**
Annotation read/write logic appears in `usePdfSelection.ts`, `usePdfBookmarks.ts`, and `CustomPdfViewer.tsx`. Three places that all know about the localStorage fallback path.

**Parse, Don't Validate violated: IPC `any` types**
Inputs cross the IPC boundary as `any` and are never validated before reaching business logic. The boundary is the most important place to validate — and it is currently the most lax.

---

## Section 15: Files to Watch — Complexity Hotspots

These files are the most likely source of bugs and the hardest to change safely:

| File | Size | Why It Is Complex |
|---|---|---|
| `CourseWorkspace.tsx` | ~121KB | Per-course workspace UI, lesson tracking, content extraction, video embeds |
| `AiTutorPanel.tsx` | ~84KB | AI chat UI, PDF annotation sync, board action rendering, session state |
| `CustomPdfViewer.tsx` | ~87KB | PDF rendering, zoom, scroll, text selection, annotations, toolbar |
| `courseHandlers.ts` | ~57KB | **WARNING:** HTTP scraping + catalog + cache + IPC all in one file |
| `professorService.ts` | ~56KB | BM25 + RRF + vector search + concept index + session management |
| `Settings.tsx` | ~62KB | All settings UI: keys, theme, study targets, sync config, danger zone |
| `Browser.tsx` | ~57KB | Multi-tab browser with webview management, history, bookmarks, Ignoto mode |
| `NotesWorkspace.tsx` | ~62KB | Standalone notes workspace, editor, image search, markdown preview |
| `ingestionQueue.ts` | ~26KB | PDF extraction + column detection + chunking + embedding + vector store |
| `usePdfSelection.ts` | ~25KB | Custom text selection algorithm, highlight geometry, annotation persistence |

Rule of thumb: If a file is over 30KB and has no tests, it is the highest-risk file in the codebase for a given change. These are the files where the agent is most likely to make a plausible-looking but wrong change.

---

## Appendix: Adding a New Migration

When adding a new migration:

1. Add a new entry to the `MIGRATIONS` array in `electron/db/migrate.ts`
2. Increment the `version` number
3. Write the SQL in the `sql` field
4. If using `ALTER TABLE`, add an idempotency guard using `hasColumn()` in the `runMigrations()` loop
5. Update the reference `.sql` file in `electron/db/migrations/` (optional but recommended)
6. Update the migration table in Section 4 of this document

**Never modify existing migration SQL.** Migrations are applied once and tracked in `schema_migrations`. Changing past migration SQL has no effect on databases that have already applied it.
