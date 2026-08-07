# Decision Log

This log records decisions that affect the software's long-term behavior. It is not a personal journal or a roadmap.

## Use SQLite as the local source of truth

**Status:** Accepted

The application uses one SQLite database under Electron's `userData` directory for core application data. This keeps setup simple and supports transactional local behavior. The tradeoff is that profile isolation depends on correct profile-scoped queries and that one database is a shared failure boundary.

## Keep migrations embedded in TypeScript

**Status:** Accepted

Runtime migrations live in `electron/db/migrate.ts` because compiled Electron output does not automatically include the reference SQL files. The `.sql` files under `electron/db/migrations/` are documentation copies and must remain synchronized.

## Keep local embeddings behind a feature flag

**Status:** Accepted; currently disabled

Local embeddings and vector retrieval add model-download, CPU, memory, and reliability costs. The code remains available for development and evaluation, but `ENABLE_RAG_PIPELINE` is currently `false`.

## Use a preload bridge for renderer capabilities

**Status:** Accepted

The renderer must access privileged operations through the preload bridge and IPC rather than directly using Node.js or SQLite APIs.

## Use webviews for the current browser implementation

**Status:** Accepted temporarily

Webviews fit the current React layout and preserve tab state with relatively little integration code. They also create lifecycle and memory costs.
