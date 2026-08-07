# Project Status

Last reviewed: 2026-08-07

CorvoVault is actively developed and not feature complete.

## Status definitions

- **Stable** — implemented and currently supported.
- **In development** — implemented in part or changing significantly.
- **Experimental** — available for investigation but not a stable contract.
- **Disabled** — code exists but is off by default.
- **Planned** — not implemented.

## Subsystems

| Area | Status | Current reality |
|---|---|---|
| Local vault | Stable | Topics, folders, materials, profiles, notes, bookmarks, and trash are persisted locally. |
| PDF viewing | In development | Custom rendering, selection, bookmarks, and annotations exist; edge cases remain. |
| Document preview | In development | Pandoc-backed previews are available for supported formats. |
| Markdown notes | In development | Markdown, KaTeX, and Mermaid rendering paths exist. |
| In-app browser | Experimental | Uses Electron webviews and has known memory and lifecycle limitations. |
| Course tools | Experimental | Catalog and extraction workflows are incomplete and depend on external sites. |
| Local embeddings | Disabled | Controlled by `electron/config/featureFlags.ts`; `ENABLE_RAG_PIPELINE` is currently `false`. |
| AI-assisted retrieval | Disabled / experimental | Retrieval and session code exists; responses require a configured remote LLM provider when enabled. |
| OCR | Experimental | OCR cache and rendering infrastructure exist; production coverage is limited. |
| Analytics | In development | Storage and read paths exist, but normal activity coverage is incomplete. |
| Cloud synchronization | Planned | Configuration fields and connection-related code exist; synchronization is not implemented. |
| Mobile companion | Planned | Some schema/service fields anticipate it; no companion application exists. |

## Important boundaries

Core vault data is stored locally by default. Browser use, course extraction, image search, and configured AI providers can make network requests. Local-first does not mean that every feature is offline or that no data can leave the device.
