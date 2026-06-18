import { ipcMain, dialog, BrowserWindow } from 'electron';

export function registerDialogHandlers(getMainWindow: () => BrowserWindow | null) {
  // File picker dialog
  ipcMain.handle('dialog:openFile', async (_event, options) => {
    const mainWindow = getMainWindow();
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
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    return dialog.showMessageBox(mainWindow, options);
  });

  // Save dialog (for ZIP export)
  ipcMain.handle('dialog:showSaveDialog', async (_event, options: Electron.SaveDialogOptions) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { filePath: undefined };
    const { filePath } = await dialog.showSaveDialog(mainWindow, options);
    return { filePath };
  });
}
