import { ipcMain } from 'electron';
import { ServiceHost } from '../ServiceHost';

export function registerSettingsHandlers(serviceHost: ServiceHost) {
  ipcMain.handle('settings:get', async (_, profileId) => serviceHost.settings.getSettings(profileId));
  ipcMain.handle('settings:save', async (_, profileId, data) => serviceHost.settings.saveSettings(profileId, data));
  
  ipcMain.handle('settings:getStats', async (_, profileId) => serviceHost.settings.getStats(profileId));
  ipcMain.handle('settings:saveStats', async (_, profileId, data) => serviceHost.settings.saveStats(profileId, data));
}
