import { ipcMain } from 'electron';
import { ServiceHost } from '../ServiceHost';
import { AppEvents } from '../../src/events/AppEvents';

export function registerThemeHandlers(serviceHost: ServiceHost) {
  ipcMain.handle('theme:get', async (_, profileId) => serviceHost.theme.getTheme(profileId));
  ipcMain.handle('theme:save', async (event, profileId, data) => {
    await serviceHost.theme.saveTheme(profileId, data);
    if (event.sender) event.sender.send(AppEvents.THEME_UPDATED, profileId);
  });
  
  ipcMain.handle('theme:getOverrides', async (_, profileId) => serviceHost.theme.getOverrides(profileId));
  ipcMain.handle('theme:saveOverrides', async (event, profileId, data) => {
    await serviceHost.theme.saveOverrides(profileId, data);
    if (event.sender) event.sender.send(AppEvents.OVERRIDES_UPDATED, profileId);
  });
}
