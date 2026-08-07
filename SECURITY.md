# Security Policy

CorvoVault uses Electron process isolation, a preload bridge, local storage, and operating-system credential facilities as security boundaries. These controls reduce risk; they do not make arbitrary web content or third-party services trustworthy.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub security advisories](https://github.com/srkaran756/CorvoVault/security/advisories/new) when possible. Include the affected component, impact, reproduction steps, and a proof of concept if available.

## Current controls

- Renderer Node integration is disabled.
- Context isolation and sandboxing are enabled for the application window.
- Privileged operations are exposed through a preload bridge.
- Navigation and IPC surfaces have allowlists and guards.
- User-provided credentials use Electron `safeStorage` when available, with legacy fallbacks.
- Core vault data is stored locally by default.

## Network and privacy limits

The embedded browser, course extraction, image search, and configured AI providers can make network requests. When AI assistance is enabled, document context may be sent to the configured remote provider. Local-first is not a guarantee that every feature is offline or that no data can leave the device.

## Support

Supported versions must be tied to actual releases or tags. Development branches are not releases. Until a tagged release policy exists, users should treat the project as actively developed rather than as a stable long-term support release.
