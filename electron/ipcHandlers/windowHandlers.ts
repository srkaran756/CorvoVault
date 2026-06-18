import { ipcMain, BrowserWindow } from 'electron';

export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('window:minimize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return false;
    return mainWindow.isMaximized();
  });
}
