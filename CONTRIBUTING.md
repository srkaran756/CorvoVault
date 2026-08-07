# Contributing to CorvoVault

CorvoVault is maintained by a solo developer and is open to focused contributions.

## Before changing code

Read:

- [Project status](PROJECT_STATUS.md)
- [Architecture](ARCHITECTURE.md)
- [Development workflow](DEVELOPMENT_WORKFLOW.md)
- [Security policy](SECURITY.md)

## Setup

```bash
npm ci
npm run electron:dev
```

Run the relevant checks before submitting a change:

```bash
npm run typecheck
npm run typecheck:electron
npm test
npm run build
```

## Code boundaries

- Keep privileged operations in the Electron main process.
- Access main-process capabilities through the preload bridge and IPC.
- Keep database access in repositories or services rather than React components.
- Validate data crossing the IPC boundary.
- Preserve profile scoping in profile-owned queries.
- Never edit an applied database migration; add a new migration.

## Pull requests

A pull request should explain the user or maintenance problem, the approach taken, verification performed, and any known limitations. Documentation changes should update status or technical references when behavior changes.

Use focused commits and Conventional Commit prefixes where practical, for example `fix(db): handle migration state` or `docs(status): clarify RAG availability`.
