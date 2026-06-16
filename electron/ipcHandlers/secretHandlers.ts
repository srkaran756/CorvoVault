import { ipcMain } from 'electron';
import { ServiceHost } from '../ServiceHost';

export function registerSecretHandlers(serviceHost: ServiceHost) {
  ipcMain.handle('secrets:getKey', async (_, profileId, provider) => serviceHost.secrets.getKey(profileId, provider));
  ipcMain.handle('secrets:saveKey', async (_, profileId, provider, key) => serviceHost.secrets.saveKey(profileId, provider, key));
  ipcMain.handle('secrets:deleteKey', async (_, profileId, provider) => serviceHost.secrets.deleteKey(profileId, provider));
}
