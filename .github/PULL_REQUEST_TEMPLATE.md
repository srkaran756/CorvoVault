## Description

<!-- Provide a concise summary of the changes introduced by this pull request and the motivation behind them. -->

## Type of Change

- [ ] 🐛 **Bug Fix**: Non-breaking change that fixes an issue.
- [ ] ✨ **New Feature**: Non-breaking change that adds functionality.
- [ ] ♻️ **Refactoring**: Code change that neither fixes a bug nor adds a feature.
- [ ] ⚡ **Performance Improvement**: Optimization that improves runtime performance or resource usage.
- [ ] 📝 **Documentation**: Changes or additions to repository documentation.
- [ ] 🔧 **Chore**: Maintenance, CI pipeline, or dependency updates.

## Related Issues

<!-- Link related issues or pull requests below using GitHub keyword closing syntax, e.g., Fixes #123 -->
Fixes #

## Key Changes & Implementation Details

<!-- Outline key architectural or code changes made in this PR -->
- 

## Visual Proof & Screenshots

<!-- If this PR modifies or introduces UI components, attach screenshots or screen recordings (WebP/GIF/PNG) demonstrating the change. Write N/A if non-visual. -->

## How to Test & Verification Steps

1. Run local type checks:
   ```bash
   npm run typecheck
   npm run typecheck:electron
   ```
2. Run unit tests:
   ```bash
   npm test
   ```
3. Run Vite build verification:
   ```bash
   npm run build
   ```
4. Manual verification steps:
   - 

## Submitter Checklist

- [ ] My code follows the architectural guidelines in [`ENGINEERING.md`](ENGINEERING.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).
- [ ] I have performed a self-review of my code.
- [ ] I have added/updated unit tests where applicable.
- [ ] All IPC payloads are validated with Zod schemas where appropriate.
- [ ] Database schema updates (if any) follow non-destructive migration rules in `electron/db/migrate.ts`.
- [ ] All local type checks (`npm run typecheck` & `npm run typecheck:electron`) and tests pass locally.
