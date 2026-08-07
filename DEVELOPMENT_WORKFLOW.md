# Development Workflow

## Install

```bash
npm ci
```

The postinstall process rebuilds native modules for Electron and copies the PDF.js worker.

## Run

```bash
npm run electron:dev
```

Use `npm run dev` when working only on the renderer.

## Verify changes

```bash
npm run typecheck
npm run typecheck:electron
npm test
npm run build
```

Changes involving native modules may also require `npm run electron:rebuild`.

## Change guidelines

- Keep privileged work in the main process.
- Validate data at IPC boundaries.
- Do not edit an applied migration; add a new migration.
- Preserve profile scoping in profile-owned queries.
- Document user-visible behavior and known limitations.
- Add or update tests for behavior that can be tested without launching Electron.

## Commits and branches

Use focused branches and Conventional Commit messages where practical, such as `feat(scope): add a capability` or `fix(scope): correct a defect`.

Branch names should be verified against the current remote state rather than assumed from historical documentation.
