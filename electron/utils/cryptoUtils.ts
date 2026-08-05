import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';

/**
 * Computes the SHA-256 hash of a file asynchronously using a stream.
 * Safe for very large files. Returns empty string on error.
 */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(''));
  });
}

let cachedEncryptionKey: Buffer | null = null;

/**
 * Retrieves the vault-wide 256-bit encryption key.
 * Generates one and encrypts it using safeStorage on first run if not already present.
 */
export function getFileEncryptionKey(): Buffer {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey;
  }

  const userDataPath = app.getPath('userData');
  const keyPath = path.join(userDataPath, 'vault_key.enc');
  const fallbackKeyPath = path.join(userDataPath, 'vault_key.json');

  if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
    if (fs.existsSync(keyPath)) {
      try {
        const encrypted = fs.readFileSync(keyPath);
        const decryptedStr = safeStorage.decryptString(encrypted);
        cachedEncryptionKey = Buffer.from(decryptedStr, 'hex');
        return cachedEncryptionKey;
      } catch (err) {
        console.error('[Crypto] Failed to decrypt vault key from safeStorage, regenerating...', err);
      }
    }

    // Generate new key
    const newKey = crypto.randomBytes(32).toString('hex');
    const encrypted = safeStorage.encryptString(newKey);
    fs.writeFileSync(keyPath, encrypted);
    cachedEncryptionKey = Buffer.from(newKey, 'hex');
    try { fs.unlinkSync(fallbackKeyPath); } catch {}
    return cachedEncryptionKey;
  } else {
    // Fallback if safeStorage is not available
    if (fs.existsSync(fallbackKeyPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(fallbackKeyPath, 'utf8'));
        cachedEncryptionKey = Buffer.from(raw.key, 'hex');
        return cachedEncryptionKey;
      } catch (err) {
        console.error('[Crypto] Failed to read fallback vault key:', err);
      }
    }

    const newKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(fallbackKeyPath, JSON.stringify({ key: newKey }), 'utf8');
    cachedEncryptionKey = Buffer.from(newKey, 'hex');
    return cachedEncryptionKey;
  }
}

/**
 * Encrypts a buffer using AES-256-CBC, prepending a random 16-byte IV.
 */
export function encryptBuffer(buffer: Buffer): Buffer {
  const key = getFileEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

/**
 * Decrypts a buffer using AES-256-CBC by extracting the prepended 16-byte IV.
 */
export function decryptBuffer(buffer: Buffer): Buffer {
  const key = getFileEncryptionKey();
  if (buffer.length < 16) {
    throw new Error('Buffer is too short to contain IV');
  }
  const iv = buffer.subarray(0, 16);
  const ciphertext = buffer.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

