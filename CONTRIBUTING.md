# Contributing to CorvoVault

Thank you for your interest in contributing to **CorvoVault**! We welcome open-source contributions from developers, designers, and curious minds.

This document provides setup instructions, architectural principles, coding standards, and step-by-step guidance for submitting pull requests.

---

## 1. Project Philosophy & Architecture Overview

CorvoVault is a local-first desktop application designed to support the journey of learning by bringing PDFs, websites, YouTube videos, Markdown notes, courses, and AI conversations into a single connected workspace.

### Key Technical Characteristics
- **Local-First**: User data lives on their local machine in SQLite (`userData/corvovault.db`) and `userData/local-files/`.
- **Decoupled Architecture**: 
  - **Main Process** (`electron/`): Node.js environment managing window lifecycles, SQLite database operations, native file access, local embedding inference, and Deep Ignoto privacy proxy.
  - **Renderer Process** (`src/`): React 19 UI styled with Tailwind CSS 4, tab management, custom PDF viewer canvas, and markdown rendering.
  - **Preload Bridge** (`electron/preload.ts`): Exposes safe API bridges via `window.electronAPI` enforcing `contextIsolation: true` and `nodeIntegration: false`.

---

## 2. Setting Up Your Development Environment

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Operating System**: Windows 10/11 (or Linux/macOS for development; Windows required for Pandoc executable packaging)
- **Bundled Binaries**: `pandoc.exe` in `resources/pandoc/` (for DOCX previews)

### Installation Steps

1. **Clone the repository and switch to the development branch**:
   ```bash
   git clone https://github.com/your-org/CorvoVault.git
   cd CorvoVault
   git checkout CorvoVault-v2-development-phase
   ```

2. **Install Node dependencies**:
   ```bash
   npm install
   ```
   *Note: The postinstall hook automatically rebuilds native C/C++ modules (`better-sqlite3`, `keytar`) against your installed Electron version.*

3. **If native module compilation fails**:
   ```bash
   npm run electron:rebuild
   ```

4. **Start the Development Environment**:
   ```bash
   npm run electron:dev
   ```
   This launches both the Vite development server (at `http://127.0.0.1:3000`) and Electron concurrently with live reloading.

5. **Run Unit Tests**:
   ```bash
   npm test
   ```

---

## 3. Codebase Guidelines & Architecture Rules

To maintain high code quality across the codebase, please follow these structural guidelines:

### A. Respect Architectural Layering
- **Repositories** (`electron/repositories/`): Pure database access logic using `better-sqlite3`. Repositories MUST NOT contain Electron main window references or React imports.
- **Application Services** (`electron/application/` & `electron/services/`): Business logic that coordinates repositories and ingestion services.
- **Composition Root** (`electron/ServiceHost.ts`): Wires concrete repository implementations to application services.
- **IPC Handlers** (`electron/ipcHandlers/`): Interface adapters. Handlers should ONLY receive IPC calls, validate inputs, delegate to `ServiceHost`, and return results.

### B. IPC Boundary Safety & Input Validation
- All IPC channels are defined in `electron/preload.ts` and called from React via `src/services/ipcService.ts`.
- Avoid passing raw `any` types across the IPC boundary. Use Zod schemas (found in `shared/ipc/schemas.ts`) to parse and validate incoming payloads.

### C. Database & Schema Migrations
- SQLite runs in **WAL mode** (`journal_mode = WAL`).
- Database migrations are defined in `electron/db/migrate.ts`.
- **Adding a new DB schema change**:
  1. Add a new migration object to the `MIGRATIONS` array in `electron/db/migrate.ts`.
  2. Increment the `version` number atomically.
  3. Provide defensive SQL statements (e.g., `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE` guarded by `hasColumn()`).
  4. Update the reference SQL file under `electron/db/migrations/`.
  5. **Never edit existing past migrations**, as applied migrations are tracked in `schema_migrations`.

### D. Feature Flags & AI Subsystem
- AI/RAG features are governed by a single feature flag switch in `electron/config/featureFlags.ts` (`isRAGEnabled()`).
- Always check feature flag states before triggering background ML models or vector search calls.

---

## 4. How to Submit a Pull Request (PR)

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** following the code formatting and architectural guidelines.
3. **Verify tests and build**:
   ```bash
   npm test
   npm run electron:build
   ```
4. **Commit your changes**:
   ```bash
   git commit -m "feat(browser): add tab reload spinner indicator"
   ```
5. **Push and create a PR**:
   - Target branch: `CorvoVault-v2-development-phase` (or `main` for release stability).
   - Ensure your PR description clearly describes the problem solved, changes made, and visual screenshots/video if UI components were modified.

---

## 5. Contact & Documentation Links

- **Engineering Architecture Specification**: [`ENGINEERING.md`](ENGINEERING.md)
- **Project Vision & Philosophy**: [`PROJECT_VISION.md`](PROJECT_VISION.md)
- **In-App Browser & Adblocker Architecture**: [`docs/IN_APP_BROWSER_GUIDE.md`](docs/IN_APP_BROWSER_GUIDE.md)
- **AI Subsystem Architecture**: [`docs/AI_SYSTEM.md`](docs/AI_SYSTEM.md)
- **Theme & Design System Guide**: [`docs/THEME_DESIGN_GUIDE.md`](docs/THEME_DESIGN_GUIDE.md)
