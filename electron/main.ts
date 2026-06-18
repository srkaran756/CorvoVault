import { app, BrowserWindow, protocol, net, session } from 'electron';
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

// New modular handlers
import { registerDialogHandlers } from './ipcHandlers/dialogHandlers';
import { registerFileHandlers } from './ipcHandlers/fileHandlers';
import { registerWebHandlers } from './ipcHandlers/webHandlers';
import { registerUpdaterHandlers } from './ipcHandlers/updaterHandlers';
import { registerWindowHandlers } from './ipcHandlers/windowHandlers';

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

  // Enable ad blocker for the persist:browser partition session
  const browserSession = session.fromPartition('persist:browser');
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    blocker.enableBlockingInSession(browserSession);
    console.log('[Browser] Ad blocker enabled for browser session.');
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

      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      console.error('Failed to handle corvovault-file protocol:', error);
      return new Response('Internal error', { status: 500 });
    }
  });

  // Register new modular IPC handlers
  registerDialogHandlers(() => mainWindow);
  registerFileHandlers();
  registerWebHandlers(() => mainWindow, isDev);
  registerUpdaterHandlers(() => mainWindow, isDev);
  registerWindowHandlers(() => mainWindow);

  // Register existing service/DB IPC handlers
  registerVaultHandlers(db, serviceHost);
  registerSettingsHandlers(serviceHost);
  registerSecretHandlers(serviceHost);
  registerThemeHandlers(serviceHost);
  registerAnalyticsHandlers(db, serviceHost);
  registerMigrationHandlers(db, serviceHost);
  registerProfessorHandlers(db, serviceHost.professor);

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
