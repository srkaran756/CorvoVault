import { app, BrowserWindow, protocol, net, session, webContents, Menu, ipcMain } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import { getDb, closeDb } from './db/connection';
import { runMigrations } from './db/migrate';
import { ServiceHost } from './ServiceHost';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

// Existing local handlers
import { registerVaultHandlers } from './ipcHandlers/vaultHandlers';
import { registerSettingsHandlers } from './ipcHandlers/settingsHandlers';
import { registerSecretHandlers } from './ipcHandlers/secretHandlers';
import { registerThemeHandlers } from './ipcHandlers/themeHandlers';
import { registerAnalyticsHandlers } from './ipcHandlers/analyticsHandlers';
import { registerMigrationHandlers } from './ipcHandlers/migrationHandlers';
import { registerProfessorHandlers } from './ipcHandlers/professorHandlers';
import { decryptBuffer } from './utils/cryptoUtils';

// New modular handlers
import { registerDialogHandlers } from './ipcHandlers/dialogHandlers';
import { registerFileHandlers } from './ipcHandlers/fileHandlers';
import { registerWebHandlers } from './ipcHandlers/webHandlers';
import { registerUpdaterHandlers } from './ipcHandlers/updaterHandlers';
import { registerWindowHandlers } from './ipcHandlers/windowHandlers';
import { registerCourseHandlers } from './ipcHandlers/courseHandlers';
import { registerDownloadHandler } from './ipcHandlers/downloadHandler';
import { registerIgnotoHandlers } from './ipcHandlers/ignotoHandlers';
import { registerOcrHandlers } from './ipcHandlers/ocrHandlers';

protocol.registerSchemesAsPrivileged([
  { 
    scheme: 'corvovault-file', 
    privileges: { 
      standard: true, 
      secure: true, 
      supportFetchAPI: true, 
      stream: true,
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

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(() => {
  // ── Show the window first for instant perceived responsiveness ──────────────
  // The window frame and title bar appear while the DB is being initialized.
  // React hydration takes ~100-300ms, so IPC handlers are always registered
  // before the first renderer call arrives.
  createWindow();

  // Register context menu downloader inside webviews to allow downloading media/links
  app.on('web-contents-created', (event, wc) => {
    if (wc.getType() === 'webview') {
      wc.on('context-menu', (e, params) => {
        const { mediaType, srcURL, linkURL } = params;
        const menuItems: any[] = [];

        if (mediaType === 'image' && srcURL) {
          menuItems.push({
            label: 'Download Image',
            click: () => {
              wc.downloadURL(srcURL);
            }
          });
        } else if (mediaType === 'video' && srcURL) {
          menuItems.push({
            label: 'Download Video',
            click: () => {
              wc.downloadURL(srcURL);
            }
          });
        } else if (mediaType === 'audio' && srcURL) {
          menuItems.push({
            label: 'Download Audio',
            click: () => {
              wc.downloadURL(srcURL);
            }
          });
        }

        if (linkURL && linkURL.trim() !== '') {
          menuItems.push({
            label: 'Download Link Target',
            click: () => {
              wc.downloadURL(linkURL);
            }
          });
        }

        if (menuItems.length > 0) {
          const menu = Menu.buildFromTemplate(menuItems);
          menu.popup({ window: mainWindow || undefined });
        }
      });
    }
  });

  // Enable ad blocker for the persist:browser partition session
  const browserSession = session.fromPartition('persist:browser');
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    // Helper to identify if a URL or its containing webview is loading ChatGPT or OpenAI.
    // This handles both the main document and all third-party subframes/iframes.
    const isChatGPT = (url: string, wcId?: number) => {
      if (url && (url.includes('chatgpt.com') || url.includes('openai.com'))) {
        return true;
      }
      if (wcId !== undefined) {
        try {
          const wc = webContents.fromId(wcId);
          const topUrl = wc?.getURL();
          if (topUrl && (topUrl.includes('chatgpt.com') || topUrl.includes('openai.com'))) {
            return true;
          }
        } catch (e) {
          // ignore error if webContents was destroyed or invalid
        }
      }
      return false;
    };

    // Completely bypass cosmetic and scriptlet injection for ChatGPT and OpenAI webviews.
    const originalInject = blocker.onInjectCosmeticFilters.bind(blocker);
    blocker.onInjectCosmeticFilters = async (event: any, url: string, msg?: any) => {
      const topUrl = event.sender?.getURL();
      if (isChatGPT(url) || (topUrl && (topUrl.includes('chatgpt.com') || topUrl.includes('openai.com')))) {
        return;
      }
      return originalInject(event, url, msg);
    };

    // Completely bypass network filtering/blocking for ChatGPT and OpenAI webviews.
    const originalBeforeRequest = blocker.onBeforeRequest.bind(blocker);
    blocker.onBeforeRequest = (details: any, callback: any) => {
      if (isChatGPT(details.url, details.webContentsId)) {
        callback({});
        return;
      }
      return originalBeforeRequest(details, callback);
    };

    // Completely bypass CSP modifications for ChatGPT and OpenAI webviews.
    const originalHeadersReceived = blocker.onHeadersReceived.bind(blocker);
    blocker.onHeadersReceived = (details: any, callback: any) => {
      if (isChatGPT(details.url, details.webContentsId)) {
        callback({});
        return;
      }
      return originalHeadersReceived(details, callback);
    };

    const enableSessionSafely = (targetSession: any) => {
      try {
        ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
        ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
      } catch (e) {}
      blocker.enableBlockingInSession(targetSession);
    };

    const youtubeSession = session.fromPartition('persist:youtube_player');
    enableSessionSafely(browserSession);
    enableSessionSafely(youtubeSession);
    console.log('[Browser] Ad blocker enabled for browser and youtube_player sessions (with ChatGPT/OpenAI bypass).');
  }).catch((err) => {
    console.error('[Browser] Failed to initialize ad blocker:', err);
  });

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

      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt': 'text/plain',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.json': 'application/json',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';

      const data = fs.readFileSync(filePath);
      let decrypted: Buffer;
      try {
        decrypted = decryptBuffer(data);
      } catch {
        decrypted = data; // legacy fallback
      }

      return new Response(decrypted, {
        headers: {
          'Content-Type': mime,
          'Content-Length': decrypted.length.toString(),
        }
      });
    } catch (error) {
      console.error('Failed to handle corvovault-file protocol:', error);
      return new Response('Internal error', { status: 500 });
    }
  });

  // Register new modular IPC handlers
  registerDialogHandlers(() => mainWindow);
  registerFileHandlers();
  registerWebHandlers(db, () => mainWindow, isDev);
  registerUpdaterHandlers(() => mainWindow, isDev);
  registerWindowHandlers(() => mainWindow);
  registerDownloadHandler(db, serviceHost, () => mainWindow);
  registerIgnotoHandlers();
  registerOcrHandlers();

  // Register existing service/DB IPC handlers
  registerVaultHandlers(db, serviceHost);
  registerSettingsHandlers(serviceHost);
  registerSecretHandlers(serviceHost);
  registerThemeHandlers(serviceHost);
  registerAnalyticsHandlers(db, serviceHost);
  registerMigrationHandlers(db, serviceHost);
  registerProfessorHandlers(db, serviceHost.professor, serviceHost.ingestionQueue);
  registerCourseHandlers(db, serviceHost);

  // NOW load the URL / file content after all handlers are fully registered
  if (mainWindow) {
    loadWindowContent(mainWindow);
  }
});

app.on('window-all-closed', () => {
  closeDb();
  app.quit();
});

// Handle Ctrl+C (SIGINT) and SIGTERM gracefully on Windows/terminal exit
process.on('SIGINT', () => {
  console.log('[Main] Received SIGINT. Closing database and exiting...');
  closeDb();
  app.quit();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Main] Received SIGTERM. Closing database and exiting...');
  closeDb();
  app.quit();
  process.exit(0);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    if (mainWindow) {
      loadWindowContent(mainWindow);
    }
  }
});
