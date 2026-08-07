# Architecture

CorvoVault is an Electron desktop application with a React renderer, a preload bridge, and a Node.js main process.

## Process boundaries

- **Renderer (`src/`)** — React UI, local UI state, PDF rendering, notes, and browser presentation.
- **Preload (`electron/preload.ts`)** — exposes the application API to the renderer through `contextBridge`.
- **Main (`electron/`)** — SQLite access, filesystem operations, native dialogs, IPC handlers, document processing, browser session management, and application services.
- **Shared (`shared/`)** — types and IPC validation shared across process boundaries.

The renderer should not access Node.js, SQLite, or the filesystem directly. Main-process capabilities cross the preload bridge through IPC.

## Application layers

The intended main-process flow is:

```text
Renderer -> preload bridge -> IPC handler -> application service -> repository or infrastructure -> SQLite or local filesystem
```

Repositories contain persistence concerns. Application services coordinate domain operations. IPC handlers should validate input, delegate, and return results. Some older subsystems, especially course handling and parts of `main.ts`, do not yet fully follow this structure.

## Storage

SQLite is the local source of truth for profiles, topics, folders, materials, notes, annotations, browser history, settings, and related subsystem data. Runtime migrations are embedded in `electron/db/migrate.ts` and currently reach version 16. Reference SQL files are maintained under `electron/db/migrations/`.

Imported files, previews, model caches, and encrypted secrets are stored under Electron's `userData` directory. See [Database migrations](docs/DATABASE_MIGRATIONS.md).

## Material ingestion

Imported documents are copied into local storage, recorded in SQLite, and queued for processing. The ingestion pipeline can extract PDF text and layout information, split content into chunks, and, when the RAG feature flag is enabled, generate local embeddings and populate vector indexes.

The embedding pipeline is currently disabled by default. The main-process queue and synchronous SQLite access also have known performance limitations.

## Architectural limitations

- IPC validation is incomplete; several handlers still accept broad types.
- `courseHandlers.ts` contains more responsibilities than the intended layering allows.
- The browser keeps hidden webviews alive, increasing memory use.
- Embedding work runs in the main process when enabled.
- Settings and some statistics are stored as JSON blobs.
- Multiple profiles share one database and depend on profile-scoped queries for isolation.
