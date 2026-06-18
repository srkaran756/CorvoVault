import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import checkDiskSpace from 'check-disk-space';
import archiver from 'archiver';
import { getDb } from '../db/connection';
import { enqueueDocxConversion } from '../infrastructure/docxPreview';
import { toLocalFilePath, assertInsideUserData } from '../utils/pathUtils';

export function registerFileHandlers() {
  // Copy file to app's local data directory
  ipcMain.handle('file:copyToLocal', async (_event, sourcePath: string) => {
    if (typeof sourcePath !== 'string' || sourcePath.length > 4096) {
      throw new Error('Invalid source path');
    }
    sourcePath = toLocalFilePath(sourcePath);
    const userDataPath = app.getPath('userData');
    const filesDir = path.join(userDataPath, 'local-files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    // ── Disk-quota guard ──────────────────────────────────────────────────────
    // Reject the copy if there isn't enough free space on the destination volume.
    // Threshold: max(200 MB absolute minimum, 2× the source file size).
    const { free } = await checkDiskSpace(filesDir);
    const sourceSize = fs.statSync(sourcePath).size;
    const MIN_FREE_BYTES = 200 * 1024 * 1024; // 200 MB
    if (free < MIN_FREE_BYTES || free < sourceSize * 2) {
      const freeMB   = Math.round(free / 1024 / 1024);
      const needsMB  = Math.round(sourceSize / 1024 / 1024);
      throw new Error(`DISK_SPACE_ERROR:${freeMB}:${needsMB}`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const fileName = path.basename(sourcePath);
    const destPath = path.join(filesDir, `${Date.now()}_${fileName}`);
    // destPath is always inside userData by construction — no traversal possible
    fs.copyFileSync(sourcePath, destPath);
    const { size } = fs.statSync(destPath);
    return { localPath: destPath, fileName, size };
  });

  // Delete local file
  ipcMain.handle('file:deleteLocal', async (_event, filePath: string) => {
    try {
      assertInsideUserData(filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (err) {
      console.error('Failed to delete local file:', err);
      return false;
    }
  });

  // Delete all local files (purge)
  ipcMain.handle('file:deleteAllLocal', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const filesDir = path.join(userDataPath, 'local-files');
      if (fs.existsSync(filesDir)) {
        const files = await fs.promises.readdir(filesDir);
        for (const file of files) {
          await fs.promises.unlink(path.join(filesDir, file));
        }
      }
      return true;
    } catch (err) {
      console.error('Failed to delete all local files:', err);
      return false;
    }
  });

  // Read file as base64 (for thumbnails, etc)
  ipcMain.handle('file:readBase64', async (_event, filePath: string) => {
    filePath = toLocalFilePath(filePath);
    assertInsideUserData(filePath);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    return `data:${mime};base64,${data.toString('base64')}`;
  });

  // Get local file path for the user data directory — only allowlisted keys
  ipcMain.handle('app:getPath', async (_event, name: string) => {
    const ALLOWED_PATHS = ['userData', 'temp', 'downloads', 'documents', 'pictures'];
    if (!ALLOWED_PATHS.includes(name)) {
      throw new Error(`[Security] app.getPath('${name}') is not allowed`);
    }
    return app.getPath(name as any);
  });

  // DOCX → PDF Conversion (see infrastructure/docxPreview.ts)
  ipcMain.handle('file:convertDocx', async (_event, filePath: string) => {
    return enqueueDocxConversion(filePath);
  });

  // Get real file size in bytes
  ipcMain.handle('file:getFileSize', async (_event, filePath: string): Promise<number> => {
    try {
      filePath = toLocalFilePath(filePath);
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  });

  // Compute SHA-256 hash of a file (streaming for large files)
  ipcMain.handle('file:hashFile', async (_event, filePath: string): Promise<string | null> => {
    try {
      filePath = toLocalFilePath(filePath);
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 200 * 1024 * 1024) {
        // Stream for large files
        return new Promise((resolve) => {
          const hash = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath);
          stream.on('data', chunk => hash.update(chunk));
          stream.on('end', () => resolve(hash.digest('hex')));
          stream.on('error', () => resolve(null));
        });
      }
      const buffer = await fs.promises.readFile(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch {
      return null;
    }
  });

  // Move file to .trash/ folder (atomic rename within same filesystem)
  ipcMain.handle('file:moveToTrash', async (
    _event,
    filePath: string
  ): Promise<{ trashPath: string } | null> => {
    try {
      assertInsideUserData(filePath);
      const trashDir = path.join(app.getPath('userData'), 'local-files', '.trash');
      await fs.promises.mkdir(trashDir, { recursive: true });

      // Preserve original filename but prefix with timestamp to avoid collisions
      const basename = path.basename(filePath);
      const trashPath = path.join(trashDir, `${Date.now()}_${basename}`);

      await fs.promises.rename(filePath, trashPath);
      return { trashPath };
    } catch {
      return null;
    }
  });

  // Check if file exists
  ipcMain.handle('file:exists', async (_event, filePath: string): Promise<boolean> => {
    try {
      filePath = toLocalFilePath(filePath);
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  // Move file back from .trash/ folder to its original location
  ipcMain.handle('file:restoreFromTrash', async (
    _event,
    trashPath: string,
    localPath: string
  ): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> => {
    console.log(`[IPC Restore] Source Path: ${trashPath}`);
    console.log(`[IPC Restore] Dest Path: ${localPath}`);

    try {
      // Both paths must stay inside userData
      assertInsideUserData(trashPath);
      assertInsideUserData(localPath);

      if (!fs.existsSync(trashPath)) {
        console.error(`[IPC Restore] SOURCE NOT FOUND on disk: ${trashPath}`);
        return { success: false, errorCode: 'ENOENT', errorMessage: 'File not found in the trash directory.' };
      }

      // Ensure destination directory exists
      const destDir = path.dirname(localPath);
      if (!fs.existsSync(destDir)) {
        console.log(`[IPC Restore] Creating directory: ${destDir}`);
        await fs.promises.mkdir(destDir, { recursive: true });
      }

      try {
        // 1. Try rename (fastest, atomic)
        await fs.promises.rename(trashPath, localPath);
        console.log(`[IPC Restore] SUCCESS: ${localPath}`);
        return { success: true };
      } catch (renameErr: any) {
        if (renameErr.code === 'EXDEV') {
          // 2. Fallback to copy + unlink for cross-device moves
          console.warn(`[IPC Restore] EXDEV fallback for ${path.basename(localPath)}`);
          await fs.promises.copyFile(trashPath, localPath);
          await fs.promises.unlink(trashPath);
          console.log(`[IPC Restore] SUCCESS (fallback): ${localPath}`);
          return { success: true };
        } else {
          throw renameErr;
        }
      }
    } catch (err: any) {
      console.error('[IPC Restore] FATAL ERROR:', err);
      return {
        success: false,
        errorCode: err.code || 'UNKNOWN',
        errorMessage: err.message || 'An unknown file system error occurred.'
      };
    }
  });

  // Permanently delete trash items older than N days (files on disk + SQLite rows)
  ipcMain.handle('file:purgeTrash', async (_event, olderThanDays: number = 30): Promise<{ filesDeleted: number; rowsDeleted: number }> => {
    let filesDeleted = 0;
    let rowsDeleted = 0;
    try {
      const trashDir = path.join(app.getPath('userData'), 'local-files', '.trash');
      const exists = await fs.promises.access(trashDir).then(() => true).catch(() => false);
      if (!exists) return { filesDeleted: 0, rowsDeleted: 0 };

      const entries = await fs.promises.readdir(trashDir);
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

      for (const entry of entries) {
        // Filename format: {timestamp}_{originalname}
        const timestamp = parseInt(entry.split('_')[0], 10);
        if (!isNaN(timestamp) && timestamp < cutoff) {
          await fs.promises.unlink(path.join(trashDir, entry)).catch(() => { });
          filesDeleted++;
        }
      }

      // Clean up orphaned SQLite rows for materials trashed longer than N days.
      const db = getDb();
      const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      const result = db.prepare(
        `DELETE FROM materials
         WHERE storage_status = 'trashed'
           AND trashed_at IS NOT NULL
           AND trashed_at < ?`
      ).run(cutoffMs);
      rowsDeleted = result.changes;

      console.log(`[Trash] Purged ${filesDeleted} file(s) and ${rowsDeleted} DB row(s) older than ${olderThanDays} days.`);
    } catch (err) {
      // Non-fatal — log and continue
      console.warn('[Trash] purgeTrash encountered an error:', err);
    }
    return { filesDeleted, rowsDeleted };
  });

  // Cross-check file paths against disk
  ipcMain.handle(
    'file:reconcileVault',
    async (_event, localPaths: string[]): Promise<{ present: string[]; missing: string[] }> => {
      const present: string[] = [];
      const missing: string[] = [];

      for (const p of localPaths) {
        try {
          await fs.promises.access(p);
          present.push(p);
        } catch {
          missing.push(p);
        }
      }
      return { present, missing };
    }
  );

  // Bundle vault files into a ZIP archive
  ipcMain.handle(
    'file:exportZip',
    async (
      _event,
      savePath: string,
      files: Array<{ localPath: string; archiveName: string }>,
      manifestJson: string
    ): Promise<{ success: boolean; error?: string }> => {
      return new Promise(resolve => {
        const output = fs.createWriteStream(savePath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => resolve({ success: true }));
        archive.on('error', err => resolve({ success: false, error: err.message }));

        archive.pipe(output);

        // Add manifest JSON as a file inside the ZIP
        archive.append(manifestJson, { name: 'manifest.json' });

        // Add each vault file
        for (const { localPath, archiveName } of files) {
          archive.file(localPath, { name: `files/${archiveName}` });
        }

        archive.finalize();
      });
    }
  );
}
