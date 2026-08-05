# Security Policy

CorvoVault takes security, data privacy, and isolation seriously. As a local-first study sanctuary and workspace application, protecting user data on the local machine and insulating native execution boundaries are primary design goals.

---

## Supported Versions

Security updates and patches are applied to the active development and major release branches:

| Version / Branch | Supported |
| --- | --- |
| `CorvoVault-v2-development-phase` | :white_check_mark: Active Development |
| `main` (Latest Tagged Release) | :white_check_mark: Supported |
| Legacy `< v1.0.0` | :x: Unsupported |

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in CorvoVault, please report it privately before making it public.

### How to Report
- **Preferred Contact**: Open a private vulnerability report via GitHub Private Vulnerability Reporting on the [CorvoVault Repository](https://github.com/srkaran756/CorvoVault/security/advisories/new), or contact the maintainers directly.
- **What to Include**:
  - A clear description of the vulnerability and potential impact.
  - Steps to reproduce or a proof-of-concept (PoC).
  - Component affected (Electron Main process, IPC bridge, Renderer, PDF parser, Webview adblocker).

### Response Expectations
- **Acknowledgement**: Reports will be acknowledged as soon as reasonably possible.
- **Resolution**: Resolution timeline depends on vulnerability severity, scope, and technical complexity. Patch progress and release details will be communicated directly to the reporter.

---

## Security Architecture & Controls

CorvoVault implements defense-in-depth architectural patterns to secure user data and process execution:

### 1. Process Isolation & Renderer Sandboxing
- **Preload Bridge**: Main and Renderer processes are strictly separated using `contextIsolation: true` and `nodeIntegration: false`. Renderers cannot directly execute native Node.js calls.
- **OS Sandboxing**: Electron main windows run with `sandbox: true` enforced.
- **Navigation Guarding**: Renderer window navigation is constrained via `will-navigate` listeners to prevent malicious redirects or untrusted URL loading within privileged contexts.

### 2. Credential Storage (`SecretService`)
- Primary encryption uses Electron's native `safeStorage` API (backed by Windows DPAPI, macOS Keychain, or Linux Secret Service API).
- Keytar operates as a legacy migration fallback when safeStorage is uninitialized.
- API keys provided by the user (e.g. OpenAI or Gemini keys) are stored encrypted and never logged or exposed to renderer scripts.

### 3. Local-First Privacy & Zero Telemetry Policy
- User notes, highlights, local files, vectors, and SQLite databases remain strictly on the user's device (`userData/corvovault.db`).
- CorvoVault includes **no telemetry or user tracking SDKs**.
- Outbound network requests occur exclusively when:
  1. Operating the built-in browser / webview (subject to adblocking filters).
  2. Calling user-configured third-party AI provider APIs (e.g. Google Gemini, OpenAI, Supabase) using the user's explicit credentials.

---

## Contact & Security Advisories

For general questions regarding CorvoVault's architecture, consult [`ENGINEERING.md`](ENGINEERING.md). Security advisories will be published on the GitHub repository releases page.
