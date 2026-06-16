const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openFileDialog: (options?: any) => ipcRenderer.invoke('dialog:openFile', options),
  copyFileToLocal: (sourcePath: string) => ipcRenderer.invoke('file:copyToLocal', sourcePath),
  deleteLocalFile: (filePath: string) => ipcRenderer.invoke('file:deleteLocal', filePath),
  deleteAllLocalFiles: () => ipcRenderer.invoke('file:deleteAllLocal'),
  fileExists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  readFileBase64: (filePath: string) => ipcRenderer.invoke('file:readBase64', filePath),
  
  // App paths
  getAppPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  
  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  
  // Content fetching
  getYouTubeInfo: (url: string) => ipcRenderer.invoke('youtube:getInfo', url),
  getUrlTitle: (url: string) => ipcRenderer.invoke('url:getTitle', url),
  
  // Document conversion
  convertDocxToHtml: (filePath: string) => ipcRenderer.invoke('file:convertDocx', filePath),
  
  // Vault storage — file size & hash
  getFileSize: (filePath: string): Promise<number> =>
    ipcRenderer.invoke('file:getFileSize', filePath),
  hashFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('file:hashFile', filePath),

  // Vault storage — trash
  moveToTrash: (filePath: string): Promise<{ trashPath: string } | null> =>
    ipcRenderer.invoke('file:moveToTrash', filePath),
  restoreFromTrash: (trashPath: string, localPath: string): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> =>
    ipcRenderer.invoke('file:restoreFromTrash', trashPath, localPath),
  purgeTrash: (olderThanDays?: number): Promise<{ filesDeleted: number; rowsDeleted: number }> =>
    ipcRenderer.invoke('file:purgeTrash', olderThanDays),

  // Vault storage — reconciliation
  reconcileVault: (localPaths: string[]): Promise<{ present: string[]; missing: string[] }> =>
    ipcRenderer.invoke('file:reconcileVault', localPaths),

  // Vault storage — export
  exportZip: (
    savePath: string,
    files: Array<{ localPath: string; archiveName: string }>,
    manifestJson: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('file:exportZip', savePath, files, manifestJson),
  showSaveDialog: (options: object): Promise<{ filePath?: string }> =>
    ipcRenderer.invoke('dialog:showSaveDialog', options),
  showErrorBox: (title: string, content: string): Promise<void> => 
    ipcRenderer.invoke('dialog:showErrorBox', title, content),
  showMessageBox: (options: object): Promise<Electron.MessageBoxReturnValue> => 
    ipcRenderer.invoke('dialog:showMessageBox', options),

  // Browser controls
  clearBrowserCache: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('browser:clearCache'),
  openDevTools: (): Promise<void> =>
    ipcRenderer.invoke('browser:openDevTools'),

  // SearXNG PDF search
  searxngSearch: (query: string, customInstance?: string): Promise<{
    success: boolean;
    results: Array<{
      title: string;
      url: string;
      content: string;
      engine: string;
      score: number;
      publishedDate: string | null;
    }>;
    instance?: string;
    error?: string;
  }> => ipcRenderer.invoke('searxng:search', query, customInstance),

  // PDF download
  downloadPdf: (url: string, fileName: string): Promise<{
    success: boolean;
    localPath?: string;
    fileName?: string;
    size?: number;
    error?: string;
  }> => ipcRenderer.invoke('pdf:downloadAndSave', url, fileName),

  // Profile identity (SQLite-backed, replaces localStorage bootstrap)
  profilesGetAll: (): Promise<Array<{ id: string; name: string; avatarPath?: string }>> =>
    ipcRenderer.invoke('profiles:getAll'),
  profilesGetCurrentId: (): Promise<string | null> =>
    ipcRenderer.invoke('profiles:getCurrentId'),
  profilesSetCurrentId: (id: string): Promise<void> =>
    ipcRenderer.invoke('profiles:setCurrentId', id),

  // PIN config (safeStorage-encrypted, falls back to legacy pin_config.json)
  getPin: (): Promise<{ hash: string; salt: string; enabled: boolean } | null> =>
    ipcRenderer.invoke('pin:get'),
  setPin: (config: { hash: string; salt: string; enabled: boolean } | null): Promise<void> =>
    ipcRenderer.invoke('pin:set', config),

  // Professor / Document Intelligence
  professorGetIngestionStatus: (materialId: string) =>
    ipcRenderer.invoke('professor:getIngestionStatus', materialId),
  professorGetRelevantChunks: (materialId: string, page: number, query: string) =>
    ipcRenderer.invoke('professor:getRelevantChunks', materialId, page, query),
  professorClassifyAndRetrieve: (materialId: string, page: number, numPages: number, query: string, conversationHistory: any[]) =>
    ipcRenderer.invoke('professor:classifyAndRetrieve', materialId, page, numPages, query, conversationHistory),
  professorGetConceptIndex: (materialId: string) =>
    ipcRenderer.invoke('professor:getConceptIndex', materialId),
  professorStoreConceptIndex: (materialId: string, indexJson: any) =>
    ipcRenderer.invoke('professor:storeConceptIndex', materialId, indexJson),
  professorSaveSession: (materialId: string, session: any) =>
    ipcRenderer.invoke('professor:saveSession', materialId, session),
  professorLoadSession: (materialId: string) =>
    ipcRenderer.invoke('professor:loadSession', materialId),

  // Annotations (SQLite-backed, replaces localStorage)
  professorGetAnnotations: (materialId: string, page?: number) =>
    ipcRenderer.invoke('professor:getAnnotations', materialId, page),
  professorSaveAnnotation: (annotation: any) =>
    ipcRenderer.invoke('professor:saveAnnotation', annotation),
  professorDeleteAnnotation: (annotationId: string) =>
    ipcRenderer.invoke('professor:deleteAnnotation', annotationId),
  professorDeleteAnnotationsForPage: (materialId: string, page: number) =>
    ipcRenderer.invoke('professor:deleteAnnotationsForPage', materialId, page),

  // PDF Bookmarks (SQLite-backed, replaces localStorage)
  professorGetPdfBookmarks: (materialId: string) =>
    ipcRenderer.invoke('professor:getPdfBookmarks', materialId),
  professorSavePdfBookmark: (bookmark: any) =>
    ipcRenderer.invoke('professor:savePdfBookmark', bookmark),
  professorDeletePdfBookmark: (bookmarkId: string) =>
    ipcRenderer.invoke('professor:deletePdfBookmark', bookmarkId),

  // Re-ingestion
  professorClearIngestion: (materialId: string) =>
    ipcRenderer.invoke('professor:clearIngestion', materialId),

  // Auto-updater controls
  checkForUpdates: (): Promise<void> =>
    ipcRenderer.invoke('updater:checkForUpdates'),
  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke('updater:downloadUpdate'),
  quitAndInstall: (): Promise<void> =>
    ipcRenderer.invoke('updater:quitAndInstall'),

  // Generic IPC invoke — used by ipcService for all channels not covered above

  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),

  // Events — only a narrow allowlisted set of channels may be subscribed to
  on: (channel: string, callback: (...args: any[]) => void) => {
    // Allowlist: only app-originated push events may be subscribed to from the renderer
    const ALLOWED_CHANNELS = [
      'material:created', 'material:trashed', 'material:restored', 'material:deleted',
      'vault:reconciled',
      'topic:created', 'topic:deleted',
      'folder:created', 'folder:deleted',
      'theme:updated', 'overrides:updated',
      'usage:logged', 'activity:logged',
      'migration:started', 'migration:complete', 'migration:failed',
      'updater:update-available', 'updater:up-to-date', 'updater:download-progress',
      'updater:update-downloaded', 'updater:error',
      'professor:ingestionProgress',  // NEW: progress updates from ingestion queue
    ];
    if (!ALLOWED_CHANNELS.includes(channel)) {
      console.warn(`[preload] Blocked subscription to disallowed channel: ${channel}`);
      return () => {};
    }
    const subscription = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  // Platform info
  isElectron: true,
  platform: process.platform,
});
