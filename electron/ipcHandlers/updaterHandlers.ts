import { ipcMain, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export function registerUpdaterHandlers(getMainWindow: () => BrowserWindow | null, isDev: boolean) {
  // Setup auto-updater listeners (production only)
  if (!isDev) {
    autoUpdater.autoDownload = false; // user-initiated download only
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('updater:update-available', info);
    });

    autoUpdater.on('update-not-available', () => {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('updater:up-to-date');
    });

    autoUpdater.on('download-progress', (prog) => {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('updater:download-progress', prog);
    });

    autoUpdater.on('update-downloaded', (info) => {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('updater:update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send('updater:error', err.message);
    });

    // Check on startup (non-blocking) after 3 seconds
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(e => console.warn('[Updater] check failed:', e));
    }, 3000);
  }

  // Renderer-accessible updater controls
  ipcMain.handle('updater:checkForUpdates', () => isDev ? null : autoUpdater.checkForUpdates());
  ipcMain.handle('updater:downloadUpdate', () => isDev ? null : autoUpdater.downloadUpdate());
  ipcMain.handle('updater:quitAndInstall', () => {
    if (!isDev) autoUpdater.quitAndInstall();
  });
}
