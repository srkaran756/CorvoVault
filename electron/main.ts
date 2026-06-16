import { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import archiver from 'archiver';
import https from 'https';
import http from 'http';
import checkDiskSpace from 'check-disk-space';
import { autoUpdater } from 'electron-updater';
import { getDb, closeDb } from './db/connection';
import { runMigrations } from './db/migrate';
import { ServiceHost } from './ServiceHost';
import { registerVaultHandlers } from './ipcHandlers/vaultHandlers';
import { registerSettingsHandlers } from './ipcHandlers/settingsHandlers';
import { registerSecretHandlers } from './ipcHandlers/secretHandlers';
import { registerThemeHandlers } from './ipcHandlers/themeHandlers';
import { registerAnalyticsHandlers } from './ipcHandlers/analyticsHandlers';
import { registerMigrationHandlers } from './ipcHandlers/migrationHandlers';
import { registerProfessorHandlers } from './ipcHandlers/professorHandlers';
import { enqueueDocxConversion } from './infrastructure/docxPreview';
import { toLocalFilePath, assertInsideUserData } from './utils/pathUtils';


protocol.registerSchemesAsPrivileged([
  { 
    scheme: 'corvovault-file', 
    privileges: { 
      standard: true, 
      secure: true, 
      supportFetchAPI: true, 
      stream: true,
      // NOTE: bypassCSP intentionally removed — serving local files does not
      // require bypassing the Content Security Policy.
      corsEnabled: true
    } 
  }
]);

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function loadWindowContent(win: BrowserWindow) {
  if (isDev) {
    win.loadURL('http://127.0.0.1:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'CorvoVault',
    icon: path.join(__dirname, '../../public/icon.png'),
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f4f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,          // OS-level sandbox isolation
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent the main window from navigating away from the local app.
  // This guards against XSS / malicious redirects trying to load an external
  // URL inside the privileged Electron renderer.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowed = isDev
      ? ['http://127.0.0.1:3000']
      : [pathToFileURL(path.join(__dirname, '../../dist/index.html')).toString()];
    const parsedUrl = new URL(navigationUrl);
    const isAllowed = allowed.some(a => navigationUrl.startsWith(a)) ||
      parsedUrl.protocol === 'corvovault-file:';
    if (!isAllowed) {
      event.preventDefault();
      console.warn(`[Security] Blocked navigation to: ${navigationUrl}`);
    }
  });

  // Block all permission requests from the renderer (camera, mic, geolocation, etc.)
  // Permissions are only granted for the embedded webview via its own session.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      // Only allow notifications for the app itself — deny everything else.
      const allowed = ['notifications'];
      callback(allowed.includes(permission));
    }
  );
}

// ─── IPC Handlers ───────────────────────────────────────────

// File picker dialog
ipcMain.handle('dialog:openFile', async (_event, options) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters,
  });
  return result;
});

// Native OS Error Box
ipcMain.handle('dialog:showErrorBox', async (_event, title: string, content: string) => {
  dialog.showErrorBox(title, content);
});

// Native OS Message Box
ipcMain.handle('dialog:showMessageBox', async (_event, options: Electron.MessageBoxOptions) => {
  if (!mainWindow) return;
  return dialog.showMessageBox(mainWindow, options);
});

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

// Open URL in external browser — validate to prevent file://, javascript:, etc.
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url !== 'string') return;
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { /* plain local path */ }

  if (!parsed) {
    if (fs.existsSync(url)) {
      await shell.openPath(url);
    }
    return;
  }

  if (parsed.protocol === 'file:' || parsed.protocol === 'corvovault-file:') {
    const filePath = toLocalFilePath(url);
    if (fs.existsSync(filePath)) {
      await shell.openPath(filePath);
    }
    return;
  }

  const ALLOWED_PROTOCOLS = ['https:', 'http:', 'mailto:'];
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    console.warn(`[Security] Blocked shell.openExternal for protocol: ${parsed.protocol}`);
    return;
  }
  await shell.openExternal(url);
});

// Fetch YouTube oEmbed data
ipcMain.handle('youtube:getInfo', async (_event, url: string) => {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!response.ok) throw new Error('Failed to fetch');
    return await response.json();
  } catch {
    return null;
  }
});

// Fetch page title from URL
ipcMain.handle('url:getTitle', async (_event, url: string) => {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 CorvoVault/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match ? match[1].trim() : new URL(url).hostname;
  } catch {
    try { return new URL(url).hostname; } catch { return url; }
  }
});

// ─── Browser Controls ────────────────────────────────────────

// Clear browser session cache
ipcMain.handle('browser:clearCache', async () => {
  try {
    // Clear the persist:browser partition session
    const browserSession = session.fromPartition('persist:browser');
    await browserSession.clearCache();
    await browserSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb'],
    });
    console.log('[Browser] Cache and storage cleared.');
    return { success: true };
  } catch (err: any) {
    console.error('[Browser] Failed to clear cache:', err);
    return { success: false, error: err.message };
  }
});

// Open DevTools for the webview (dev mode only)
ipcMain.handle('browser:openDevTools', async () => {
  if (!mainWindow || !isDev) return;
  mainWindow.webContents.openDevTools({ mode: 'detach' });
});

// ─── Web PDF Search (DuckDuckGo HTML) ──────────────────────────────────────

ipcMain.handle('searxng:search', async (_event, query: string) => {
  const pdfQuery = `${query} filetype:pdf`;
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(pdfQuery);
  
  try {
    console.log(`[Web Search] Querying DuckDuckGo: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CorvoVault/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from DuckDuckGo`);
    }
    
    const html = await response.text();
    const results = [];
    
    // Extract results using regex to avoid bringing in a DOM parser dependency
    const resultBlockRegex = /<h2 class="result__title">([\s\S]*?)<\/h2>[\s\S]*?<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    
    while ((match = resultBlockRegex.exec(html)) !== null) {
      let titleHtml = match[1];
      let snippetHtml = match[2];
      
      const urlMatch = /href="([^"]+)"/.exec(titleHtml);
      if (!urlMatch) continue;
      
      let rawUrl = urlMatch[1];
      // DuckDuckGo obfuscates URLs via their redirector
      if (rawUrl.includes('uddg=')) {
        rawUrl = decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]);
      } else if (rawUrl.startsWith('//')) {
        rawUrl = 'https:' + rawUrl;
      }
      
      const title = titleHtml.replace(/<[^>]+>/g, '').trim();
      const snippet = snippetHtml.replace(/<[^>]+>/g, '').trim();
      
      results.push({
        title: title || 'Untitled PDF',
        url: rawUrl,
        content: snippet,
        engine: 'DuckDuckGo',
        score: 1,
        publishedDate: null,
      });
    }
    
    console.log(`[Web Search] Found ${results.length} PDF results`);
    return { success: true, results, instance: 'DuckDuckGo' };
    
  } catch (err: any) {
    console.warn(`[Web Search] Failed: ${err.message}`);
    return { success: false, error: err.message || 'Unknown error', results: [] };
  }
});

// Download a PDF from URL and save to vault's local-files directory
ipcMain.handle('pdf:downloadAndSave', async (_event, pdfUrl: string, fileName: string) => {
  const userDataPath = app.getPath('userData');
  const filesDir = path.join(userDataPath, 'local-files');
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
  }

  // Sanitize filename
  const safeName = fileName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').substring(0, 120);
  const destPath = path.join(filesDir, `${Date.now()}_${safeName}`);

  return new Promise((resolve) => {
    const download = (url: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      const proto = url.startsWith('https') ? https : http;

      const req = proto.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 CorvoVault/1.0',
          'Accept': 'application/pdf,*/*',
        },
        timeout: 30000,
      }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          download(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${res.statusCode}` });
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          const stats = fs.statSync(destPath);
          resolve({
            success: true,
            localPath: destPath,
            fileName: safeName,
            size: stats.size,
          });
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          resolve({ success: false, error: err.message });
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Download timed out after 30 seconds' });
      });
    };

    download(pdfUrl);
  });
});

// ─── DOCX → PDF Conversion (see infrastructure/docxPreview.ts) ─────────────

ipcMain.handle('file:convertDocx', async (_event, filePath: string) => {
  return enqueueDocxConversion(filePath);
});

// ─── Vault Storage Handlers ─────────────────────────────────

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
    // Uses the already-open DB singleton — safe because getDb() is initialized
    // in app.whenReady() before any IPC calls are dispatched by the renderer.
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

// Save dialog (for ZIP export)
ipcMain.handle('dialog:showSaveDialog', async (_event, options: Electron.SaveDialogOptions) => {
  if (!mainWindow) return { filePath: undefined };
  const { filePath } = await dialog.showSaveDialog(mainWindow, options);
  return { filePath };
});

// ─── Window Controls ─────────────────────────────────────────
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});
ipcMain.handle('window:isMaximized', () => {
  if (!mainWindow) return false;
  return mainWindow.isMaximized();
});

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(() => {
  // ── Show the window first for instant perceived responsiveness ──────────────
  // The window frame and title bar appear while the DB is being initialized.
  // React hydration takes ~100-300ms, so IPC handlers are always registered
  // before the first renderer call arrives.
  createWindow();

  const db = getDb();
  runMigrations(db);
  const serviceHost = new ServiceHost(db, () => mainWindow);
  serviceHost.ingestionQueue.resumeOnStartup();

  // Register custom protocol for local files
  // Use modern protocol.handle for Electron 35+
  protocol.handle('corvovault-file', (request) => {
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);
      
      // More robust Windows path handling
      if (process.platform === 'win32') {
        // Handle both /C:/path and //C:/path and C:/path
        filePath = filePath.replace(/^\/+/, '');  // Strip ALL leading slashes
        // If it still doesn't look like a Windows path (no drive letter), check host
        if (!/^[a-zA-Z]:/.test(filePath) && url.host) {
          filePath = `${url.host}:/${filePath}`;
        }
      }
      
      filePath = filePath.replace(/\0/g, '').trim();

      if (!fs.existsSync(filePath)) {
        console.warn(`[corvovault-file] Not found: ${filePath}`);
        return new Response('File not found', { status: 404 });
      }

      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      console.error('Failed to handle corvovault-file protocol:', error);
      return new Response('Internal error', { status: 500 });
    }
  });

  registerVaultHandlers(db, serviceHost);
  registerSettingsHandlers(serviceHost);
  registerSecretHandlers(serviceHost);
  registerThemeHandlers(serviceHost);
  registerAnalyticsHandlers(db, serviceHost);
  registerMigrationHandlers(db, serviceHost);
  registerProfessorHandlers(db, serviceHost.professor);

  // ── Auto-updater setup (production only) ─────────────────────────────────
  // Silently checks GitHub Releases for a newer version on startup.
  // The renderer can trigger checks/installs via the three IPC channels below.
  if (!isDev) {
    autoUpdater.autoDownload    = false; // user-initiated download only
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available',    (info) => mainWindow?.webContents.send('updater:update-available', info));
    autoUpdater.on('update-not-available',()     => mainWindow?.webContents.send('updater:up-to-date'));
    autoUpdater.on('download-progress',   (prog) => mainWindow?.webContents.send('updater:download-progress', prog));
    autoUpdater.on('update-downloaded',   (info) => mainWindow?.webContents.send('updater:update-downloaded', info));
    autoUpdater.on('error',               (err)  => mainWindow?.webContents.send('updater:error', err.message));

    // Check on startup (non-blocking)
    setTimeout(() => autoUpdater.checkForUpdates().catch(e => console.warn('[Updater] check failed:', e)), 3000);
  }

  // Renderer-accessible updater controls
  ipcMain.handle('updater:checkForUpdates',    () => isDev ? null : autoUpdater.checkForUpdates());
  ipcMain.handle('updater:downloadUpdate',     () => isDev ? null : autoUpdater.downloadUpdate());
  ipcMain.handle('updater:quitAndInstall',     () => { if (!isDev) autoUpdater.quitAndInstall(); });

  // NOW load the URL / file content after all handlers are fully registered
  if (mainWindow) {
    loadWindowContent(mainWindow);
  }
});


app.on('window-all-closed', () => {
  closeDb();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    if (mainWindow) {
      loadWindowContent(mainWindow);
    }
  }
});
