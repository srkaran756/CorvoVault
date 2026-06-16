import type { Material } from '../types';
import type { IpcResult } from '@shared/ipc/envelope';

// Safe IPC wrapper: returns a resolved empty value if electronAPI is not available (dev browser mode)
function invoke(channel: string, ...args: any[]): Promise<any> {
  if (!window.electronAPI) {
    console.warn(`[ipcService] No electronAPI — channel ${channel} called outside Electron`);
    return Promise.resolve(null);
  }
  return window.electronAPI.invoke(channel, ...args);
}

function unwrapVaultSearchResult(raw: unknown): Material[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as IpcResult<Material[]>;
  if (r.success === true && Array.isArray(r.data)) return r.data;
  if (r.success === false) console.warn('[ipcService] vault:searchMaterials:', r.code, r.message);
  return [];
}

export const ipcService = {
  vault: {
    getMaterials: (folderId: string, profileId: string) => invoke('vault:getMaterials', folderId, profileId),
    getAllMaterials: (profileId: string) => invoke('vault:getAllMaterials', profileId),
    getMaterialCounts: (profileId: string) => invoke('vault:getMaterialCounts', profileId),
    getTrashed: (profileId: string) => invoke('vault:getTrashed', profileId),
    searchMaterials: async (profileId: string, query: string) => {
      const raw = await invoke('vault:searchMaterials', profileId, query);
      return unwrapVaultSearchResult(raw);
    },
    capture: (type: string, data: any) => invoke('vault:capture', type, data),
    trashMaterial: (id: string, profileId: string) => invoke('vault:trashMaterial', id, profileId),
    restoreMaterial: (id: string, profileId: string) => invoke('vault:restoreMaterial', id, profileId),
    deleteMaterial: (id: string) => invoke('vault:deleteMaterial', id),
    getTrashPath: (id: string) => invoke('vault:getTrashPath', id),
    getVideoProgress: (materialId: string) => invoke('vault:getVideoProgress', materialId),
    saveVideoProgress: (progress: any) => invoke('vault:saveVideoProgress', progress),
    runIntegrityCheck: (profileId: string) => invoke('vault:runIntegrityCheck', profileId),
  },
  topics: {
    getAll: (profileId: string) => invoke('topics:getAll', profileId),
    create: (profileId: string, name: string) => invoke('topics:create', profileId, name),
    update: (id: string, name: string) => invoke('topics:update', id, name),
    delete: (id: string) => invoke('topics:delete', id),
  },
  folders: {
    getAll: (topicId: string) => invoke('folders:getAll', topicId),
    getAllByProfile: (profileId: string) => invoke('folders:getAllByProfile', profileId),
    create: (topicId: string, profileId: string, name: string) => invoke('folders:create', topicId, profileId, name),
    update: (id: string, name: string) => invoke('folders:update', id, name),
    delete: (id: string) => invoke('folders:delete', id),
  },
  notes: {
    getAll: (materialId: string) => invoke('notes:getAll', materialId),
    add: (materialId: string, content: string) => invoke('notes:add', materialId, content),
    update: (id: string, content: string) => invoke('notes:update', id, content),
    delete: (id: string) => invoke('notes:delete', id),
  },
  settings: {
    get: (profileId: string) => invoke('settings:get', profileId),
    save: (profileId: string, data: any) => invoke('settings:save', profileId, data),
    getStats: (profileId: string) => invoke('settings:getStats', profileId),
    saveStats: (profileId: string, data: any) => invoke('settings:saveStats', profileId, data),
  },
  secrets: {
    getKey: (profileId: string, provider: string) => invoke('secrets:getKey', profileId, provider),
    saveKey: (profileId: string, provider: string, key: string) => invoke('secrets:saveKey', profileId, provider, key),
    deleteKey: (profileId: string, provider: string) => invoke('secrets:deleteKey', profileId, provider),
  },
  theme: {
    get: (profileId: string) => invoke('theme:get', profileId),
    save: (profileId: string, data: any) => invoke('theme:save', profileId, data),
    getOverrides: (profileId: string) => invoke('theme:getOverrides', profileId),
    saveOverrides: (profileId: string, data: any) => invoke('theme:saveOverrides', profileId, data),
  },
  analytics: {
    logUsage: (data: any) => invoke('analytics:logUsage', data),
    getHeatmap: (profileId: string, days: number) => invoke('analytics:getHeatmap', profileId, days),
    getWeekSummary: (profileId: string) => invoke('analytics:getWeekSummary', profileId),
    getDistractors: (profileId: string, days: number) => invoke('analytics:getDistractors', profileId, days),
  },
  migration: {
    getStatus: () => invoke('migration:getStatus'),
    exportComplete: (snapshot: any) => invoke('migration:exportComplete', snapshot),
  },
  bookmarks: {
    getAll: (profileId: string) => invoke('bookmarks:getAll', profileId),
    add: (profileId: string, title: string, url: string) => invoke('bookmarks:add', profileId, title, url),
    delete: (id: string) => invoke('bookmarks:delete', id),
  },
  profiles: {
    syncAll: (profiles: any[]) => invoke('profiles:syncAll', profiles || []),
    getAll: (): Promise<Array<{ id: string; name: string; avatarPath?: string }>> =>
      invoke('profiles:getAll'),
    getCurrentId: (): Promise<string | null> => invoke('profiles:getCurrentId'),
    setCurrentId: (id: string): Promise<void> => invoke('profiles:setCurrentId', id),
  },
  pin: {
    get: (): Promise<{ enabled: boolean } | null> =>
      invoke('pin:get'),
    set: (pin: string | null): Promise<void> =>
      invoke('pin:set', pin),
    verify: (pin: string): Promise<boolean> =>
      invoke('pin:verify', pin),
  },
};
