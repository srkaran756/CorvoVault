# Contributing to CorvoVault

Thank you for your interest in contributing to **CorvoVault**! We welcome open-source contributions from developers, designers, and curious minds.

This document provides setup instructions, architectural principles, coding standards, branching model guidelines, and step-by-step guidance for submitting pull requests.

---

## 1. Project Philosophy & Architecture Overview

CorvoVault is a local-first desktop application designed to support the journey of learning by bringing PDFs, websites, YouTube videos, Markdown notes, courses, and AI conversations into a single connected workspace.

### Key Technical Characteristics
- **Local-First**: User data lives on the local machine in SQLite (`userData/corvovault.db`) and `userData/local-files/`.
- **Decoupled Architecture**: 
  - **Main Process** (`electron/`): Node.js environment managing window lifecycles, SQLite database operations, native file access, local embedding inference, and Deep Ignoto privacy proxy.
  - **Renderer Process** (`src/`): React 19 UI styled with Tailwind CSS 4, tab management, custom PDF viewer canvas, and markdown rendering.
  - **Preload Bridge** (`electron/preload.ts`): Exposes safe API bridges via `window.electronAPI` enforcing `contextIsolation: true` and `nodeIntegration: false`.

---

## 2. Setting Up Your Development Environment

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **Operating System**: Windows 10/11 (or Linux/macOS for development; Windows required for Pandoc executable packaging)
- **Bundled Binaries**: `pandoc.exe` in `resources/pandoc/` (for DOCX previews)

### Installation Steps

1. **Clone the repository and switch to the development branch**:
   ```bash
   git clone https://github.com/srkaran756/CorvoVault.git
   cd CorvoVault
   git checkout CorvoVault-v2-development-phase
   ```

2. **Install Node dependencies**:
   ```bash
   npm ci
   ```
   *Note: The postinstall hook automatically rebuilds native C/C++ modules (`better-sqlite3`, `keytar`, `sqlite-vec`) against your installed Electron version.*

3. **If native module compilation fails**:
   ```bash
   npm run electron:rebuild
   ```

4. **Start the Development Environment**:
   ```bash
   npm run electron:dev
   ```
   This launches both the Vite development server (at `http://127.0.0.1:3000`) and Electron concurrently with live reloading.

5. **Run Local Verification Checks**:
   ```bash
   npm run typecheck            # Check UI TypeScript types
   npm run typecheck:electron   # Check Electron Main process TypeScript types
   npm test                     # Run Vitest test suite
   npm run build                # Verify Vite frontend build
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

## 4. Branching Model & Git Strategy

CorvoVault uses a structured branching model to maintain stability while enabling rapid feature development:

```text
main (Production & Tagged Releases)
└── CorvoVault-v2-development-phase (Primary Integration Branch)
      ├── feature/<short-description>   (New user-facing features)
      ├── fix/<short-description>       (Bug fixes & patches)
      ├── refactor/<short-description>  (Internal architectural cleanup)
      └── chore/<short-description>     (Maintenance & infrastructure updates)
```

### Branch Definitions & Purpose
- **`main`**: Contains production-ready, stable releases. Code is merged into `main` exclusively from `CorvoVault-v2-development-phase` upon release cut.
- **`CorvoVault-v2-development-phase`**: Primary integration branch for active development. All feature branches, bug fixes, and chores should target this branch.
- **Working Branches**:
  - `feature/pdf-search-highlight`: For new user-facing features.
  - `fix/webview-adblock-crash`: For resolving reported bugs.
  - `refactor/ipc-schema-validation`: For internal code improvements without functionality changes.
  - `chore/ci-workflow-setup`: For maintenance, dependency updates, or documentation updates.

### Conventional Commit Standard
Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<scope>): <short description>
```

**Types**:
- `feat`: A new user-facing feature.
- `fix`: A bug fix.
- `docs`: Documentation changes only.
- `style`: Formatting, missing semi-colons, no code logic changes.
- `refactor`: Code change that neither fixes a bug nor adds a feature.
- `test`: Adding missing tests or correcting existing tests.
- `chore`: Infrastructure updates, package scripts, or dependency maintenance.

**Examples**:
- `feat(browser): add tab reload spinner indicator`
- `fix(db): resolve migration lock error on startup`
- `chore(ci): add GitHub Actions workflow for type checking`

---

## 5. How to Submit a Pull Request (PR)

1. **Create a Working Branch** from `CorvoVault-v2-development-phase`:
   ```bash
   git checkout CorvoVault-v2-development-phase
   git pull origin CorvoVault-v2-development-phase
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** adhering to architectural guidelines and code style.
3. **Run local verification**:
   ```bash
   npm run typecheck
   npm run typecheck:electron
   npm test
   npm run build
   ```
4. **Commit your changes** using Conventional Commits:
   ```bash
   git commit -m "feat(scope): brief description"
   ```
5. **Push and open a Pull Request**:
   - Target branch: `CorvoVault-v2-development-phase`
   - Fill out `.github/PULL_REQUEST_TEMPLATE.md` completely.
   - Verify that all CI checks pass.

---

## 6. Contact & Documentation Links

- **Engineering Architecture Specification**: [`ENGINEERING.md`](ENGINEERING.md)
- **Project Vision & Philosophy**: [`PROJECT_VISION.md`](PROJECT_VISION.md)
- **Security Policy**: [`SECURITY.md`](SECURITY.md)
- **In-App Browser & Adblocker Architecture**: [`docs/IN_APP_BROWSER_GUIDE.md`](docs/IN_APP_BROWSER_GUIDE.md)
- **AI Subsystem Architecture**: [`docs/AI_SYSTEM.md`](docs/AI_SYSTEM.md)
- **Theme & Design System Guide**: [`docs/THEME_DESIGN_GUIDE.md`](docs/THEME_DESIGN_GUIDE.md)
