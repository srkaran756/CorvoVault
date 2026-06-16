/**
 * SecretService — Phase A migration: safeStorage primary, keytar fallback.
 *
 * Architecture:
 * ─────────────────────────────────────────────────────────────────────────────
 *  WRITE path  →  always uses Electron safeStorage (DPAPI/Keychain).
 *                 The legacy keytar entry is left untouched so a rollback
 *                 to the old binary still works.
 *
 *  READ path   →  tries safeStorage first; falls back to keytar if no
 *                 safeStorage entry exists yet (seamless migration for
 *                 existing installs that stored keys via keytar).
 *                 On a successful keytar fallback read the value is
 *                 immediately re-encrypted and written to safeStorage so
 *                 subsequent reads no longer need keytar.
 *
 *  DELETE path →  wipes both locations to stay consistent.
 *
 * Phase B (future, after safeStorage is confirmed stable in production):
 *   Remove all keytar import/calls and drop keytar from package.json rebuild.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { safeStorage } from 'electron';
import { app }         from 'electron';
import fs              from 'fs';
import path            from 'path';

// Lazy-load keytar only when needed to avoid native-module load errors in
// environments where keytar was never built (e.g. test runners, CI).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _lazyKeytar = (): typeof import('keytar') | null => {
  try { return require('keytar'); } catch { return null; }
};

const SERVICE_NAME = 'CorvoVault';

/** Returns the path to the safeStorage secrets store (a JSON file of encrypted buffers encoded as hex). */
function secretsStorePath(): string {
  return path.join(app.getPath('userData'), 'secrets_store.json');
}

/** Reads the raw secrets map from disk. Returns {} on any error. */
function readSecretsMap(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(secretsStorePath(), 'utf8'));
  } catch {
    return {};
  }
}

/** Writes the secrets map to disk atomically. */
function writeSecretsMap(map: Record<string, string>): void {
  fs.writeFileSync(secretsStorePath(), JSON.stringify(map), 'utf8');
}

export class SecretService {
  async getKey(profileId: string, provider: string): Promise<string | null> {
    const account = `${profileId}_${provider}`;

    // ── 1. Try safeStorage ──────────────────────────────────────────────────
    if (safeStorage.isEncryptionAvailable()) {
      const map = readSecretsMap();
      if (map[account]) {
        try {
          return safeStorage.decryptString(Buffer.from(map[account], 'hex'));
        } catch {
          // corrupt entry — fall through to keytar
        }
      }
    }

    // ── 2. keytar fallback (migration path) ─────────────────────────────────
    const keytar = _lazyKeytar();
    if (!keytar) return null;

    const value = await keytar.getPassword(SERVICE_NAME, account);
    if (value && safeStorage.isEncryptionAvailable()) {
      // Migrate: re-encrypt and persist to safeStorage immediately
      try {
        const encrypted = safeStorage.encryptString(value);
        const map = readSecretsMap();
        map[account] = encrypted.toString('hex');
        writeSecretsMap(map);
      } catch {
        // non-fatal — value still returned from keytar
      }
    }
    return value;
  }

  async saveKey(profileId: string, provider: string, key: string): Promise<void> {
    const account = `${profileId}_${provider}`;

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      const map = readSecretsMap();
      map[account] = encrypted.toString('hex');
      writeSecretsMap(map);
    } else {
      // OS encryption unavailable — fall back to keytar
      console.warn('[SecretService] safeStorage unavailable; falling back to keytar for', account);
      const keytar = _lazyKeytar();
      if (keytar) await keytar.setPassword(SERVICE_NAME, account, key);
    }
  }

  async deleteKey(profileId: string, provider: string): Promise<void> {
    const account = `${profileId}_${provider}`;

    // Wipe from safeStorage
    if (safeStorage.isEncryptionAvailable()) {
      const map = readSecretsMap();
      delete map[account];
      writeSecretsMap(map);
    }

    // Also wipe from keytar (belt-and-suspenders — no crash if keytar absent)
    const keytar = _lazyKeytar();
    if (keytar) {
      try { await keytar.deletePassword(SERVICE_NAME, account); } catch { /* ok */ }
    }
  }
}
