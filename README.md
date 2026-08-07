# CorvoVault

CorvoVault is an actively developed Electron desktop application for organizing and working with local study materials.

The current application supports local vault organization, PDF viewing and annotation, Markdown notes, profiles, bookmarks, and an embedded browser. Several advanced systems, including local embeddings, AI-assisted retrieval, course workflows, analytics, OCR, and synchronization, are incomplete, experimental, or disabled by default.

This repository prioritizes accurate status reporting over feature marketing.

## Current status

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the status of each subsystem.

## Development setup

Prerequisites: Node.js 20 or later, npm, and the bundled Pandoc resource for document preview work.

```bash
npm ci
npm run electron:dev
```

Useful checks:

```bash
npm run typecheck
npm run typecheck:electron
npm test
npm run build
```

See [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) for the complete local workflow.

## Documentation

- [Project status](PROJECT_STATUS.md)
- [Product philosophy](PRODUCT_PHILOSOPHY.md)
- [Architecture](ARCHITECTURE.md)
- [Decision log](DECISION_LOG.md)
- [Development workflow](DEVELOPMENT_WORKFLOW.md)
- [Release process](RELEASE_PROCESS.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Technical guides](docs/README.md)

## License

CorvoVault is licensed under the [Apache License 2.0](LICENSE).
