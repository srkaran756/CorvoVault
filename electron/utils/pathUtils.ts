import { app } from 'electron';
import path from 'path';

export function toLocalFilePath(value: string): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return raw;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'file:') {
      let pathname = decodeURIComponent(parsed.pathname);
      if (process.platform === 'win32') pathname = pathname.replace(/^\/+/, '');
      return pathname.replace(/\0/g, '').trim();
    }
    if (parsed.protocol === 'corvovault-file:') {
      let pathname = decodeURIComponent(parsed.pathname);
      if (process.platform === 'win32') {
        pathname = pathname.replace(/^\/+/, '');
        if (!/^[a-zA-Z]:/.test(pathname) && parsed.host) {
          pathname = `${parsed.host}:/${pathname}`;
        }
      }
      return pathname.replace(/\0/g, '').trim();
    }
  } catch {
    // Plain filesystem path.
  }

  return raw.replace(/\0/g, '').trim();
}

export function assertInsideUserData(filePath: string): void {
  const resolved = path.resolve(toLocalFilePath(filePath));
  const lowerResolved = resolved.toLowerCase();

  // 1. Allow files inside current userData directory
  const userDataPath = path.resolve(app.getPath('userData')).toLowerCase();
  const relUserData = path.relative(userDataPath, resolved);
  if (!relUserData.startsWith('..') && !path.isAbsolute(relUserData)) {
    return;
  }

  // 2. Allow files inside current temp directory
  const tempPath = path.resolve(app.getPath('temp')).toLowerCase();
  const relTemp = path.relative(tempPath, resolved);
  if (!relTemp.startsWith('..') && !path.isAbsolute(relTemp)) {
    return;
  }

  // 3. Allow files inside corvovault user data directories case-insensitively
  if (
    lowerResolved.includes('appdata\\roaming\\corvovault') ||
    lowerResolved.includes('appdata\\local\\corvovault') ||
    lowerResolved.includes('appdata/roaming/corvovault') ||
    lowerResolved.includes('appdata/local/corvovault')
  ) {
    return;
  }

  throw new Error(`[Security] Path traversal blocked: ${filePath}`);
}
