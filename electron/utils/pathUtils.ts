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
  const userDataPath = app.getPath('userData');
  const resolved = path.resolve(toLocalFilePath(filePath));
  const relative = path.relative(path.resolve(userDataPath), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`[Security] Path traversal blocked: ${filePath}`);
  }
}
