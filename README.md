# CorvoVault

**Your little learning partner. A home for curious minds.**

CorvoVault is a local-first desktop application built to support the journey of learning. Instead of treating learning resources as isolated files, CorvoVault connects your PDFs, websites, YouTube videos, research papers, notes, and AI conversations into a single evolving knowledge space designed to help you move from curiosity to understanding. Built with Electron, React, and TypeScript, with all your data staying locally on your machine.


## Screenshots

### Vault 
we are updating the screenshots section on this repository.

### PDF Reader & AI Assistant
we are updating the screenshots section on this repository.

## What it does

- Organize PDFs, DOCX files, videos, links, and YouTube videos into a topic → folder → material hierarchy
- Read PDFs in a custom built-in viewer with text selection, highlighting, freehand drawing, zoom, rotation, and reading filters
- Preview DOCX/ODT/RTF files inline (converted via bundled Pandoc to PDF)
- **Standalone Notes Workspace**: Rich Markdown editing with KaTeX LaTeX math equations (`$...$`, `$$...$$`), live Mermaid diagrams, and web image search embedding
- **Online Course Explorer & Workspaces**: Browse 60+ online courses, extract lessons, and attach study materials
- **In-App Web Browser & Privacy Mode**: Isolated Chromium webview tabs, history logging, domain render mode caching, download interceptor prompt, and Deep Ignoto DNS-over-HTTPS proxy
- **YouTube Rescue Player & Multi-Layer Adblocker**: Embedded YouTube watch player with continuous progress persistence, Ghostery network filtering, InnerTube API JSON payload sanitization (`/youtubei/v1/player`), and HTML5 video auto-skip fallbacks
- Extract text from document images using local OCR capabilities (PP-OCRv6 / PaddleOCR)
- Chat with an AI tutor about the document you are reading (requires your own API key) — *Experimental / Explorer Feature governed by `electron/config/featureFlags.ts`*
- View a study dashboard with time-tracked activity, heatmap, and usage stats
- Multiple local profiles on one installation, each with its own vault, settings, and theme

## Tech stack

- Electron 35 (main process, preload bridge, and isolated webview host)
- React 19 + Vite 6 (renderer)
- TypeScript 5.8
- SQLite via `better-sqlite3` (WAL mode) with `sqlite-vec` vector extension
- Tailwind CSS 4
- `@xenova/transformers` — ONNX runtime for local embedding generation (no GPU required)
- KaTeX (`katex`, `rehype-katex`, `remark-math`) & Mermaid (`mermaid`) for rich markdown rendering

## Getting started (development)

**Prerequisites**
- Windows 10 or later (Node.js 18+)
- `pandoc.exe` present in `resources/pandoc/` (for DOCX preview)

**Install and Start**
```bash
npm install
npm run electron:dev
```

## Documentation & Architecture Guides

- **Open-Source Contributing Guide**: [`CONTRIBUTING.md`](CONTRIBUTING.md) — Setup, layer rules, IPC safety, DB migration rules, and PR process.
- **Engineering Specification**: [`ENGINEERING.md`](ENGINEERING.md) — Complete system architecture, IPC contracts, data model (16 migrations), and technical priorities.
- **In-App Browser & YouTube Adblock Guide**: [`docs/IN_APP_BROWSER_GUIDE.md`](docs/IN_APP_BROWSER_GUIDE.md) — Multi-process webview setup and 3-layer YouTube ad-blocking mechanism.
- **AI System Architecture**: [`docs/AI_SYSTEM.md`](docs/AI_SYSTEM.md) — Local ONNX embedding pipeline, hybrid vector search (BM25 + `sqlite-vec` + RRF), and agent tool loops.
- **Performance & Memory Tuning**: [`docs/PERFORMANCE_AND_RAM_GUIDE.md`](docs/PERFORMANCE_AND_RAM_GUIDE.md) — Process memory analysis and webview RAM management.
- **Theme & Design System**: [`docs/THEME_DESIGN_GUIDE.md`](docs/THEME_DESIGN_GUIDE.md) — CSS variable token system and theme overrides.
- **Project Philosophy**: [`PROJECT_VISION.md`](PROJECT_VISION.md) — Long-term goals and learning principles.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for full instructions on setting up your environment, running tests, submitting pull requests, and following architectural guidelines.



## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `NODE_MODULE_VERSION mismatch` on startup | Native modules built against wrong Node ABI | Run `npm run electron:rebuild` |
| Blank renderer screen | Vite server not running | Use `npm run electron:dev`, not `electron:start` alone |
| DOCX preview fails | `pandoc.exe` missing | Confirm `resources/pandoc/pandoc.exe` exists |

## License

See [`LICENSE`](LICENSE) in the repository root.
