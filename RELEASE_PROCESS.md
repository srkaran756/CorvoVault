# Release Process

CorvoVault is currently an actively developed application. A release should represent a verified build, not merely a version-number change.

## Release readiness

Before a release:

1. Review `PROJECT_STATUS.md` for claims that changed.
2. Run UI and Electron type checks.
3. Run the test suite.
4. Run the production build.
5. Verify packaged resources, especially Pandoc and PDF.js assets.
6. Test database migration startup from a clean profile and an existing profile.
7. Record user-visible changes and known limitations.

## Packaging

```bash
npm run electron:build
```

Electron Builder produces packages under `release/` and is configured for GitHub publishing when publishing is enabled.

## Support policy

Supported versions must be stated using actual released versions or tags. Development branches are not releases.
