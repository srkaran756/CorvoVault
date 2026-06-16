import { ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { ServiceHost } from '../ServiceHost';

export function registerAnalyticsHandlers(db: Database.Database, serviceHost: ServiceHost) {
  ipcMain.handle('analytics:logUsage', async (_, data) => {
    const profileRow = db.prepare('SELECT id FROM profiles WHERE current = 1 LIMIT 1').get() as { id: string } | undefined;
    const profileId = profileRow?.id || 'default';
    return serviceHost.analytics.logMobileUsage(profileId, data);
  });
  ipcMain.handle('analytics:getHeatmap', async (_, profileId, days) => serviceHost.analytics.getHeatmap(profileId, days));
  ipcMain.handle('analytics:getWeekSummary', async (_, profileId) => serviceHost.analytics.getWeekSummary(profileId));
  ipcMain.handle('analytics:getDistractors', async (_, profileId, days) => serviceHost.analytics.getTopDistractors(profileId, days));
}
