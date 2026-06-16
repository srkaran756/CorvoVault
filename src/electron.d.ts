// Type declarations for Electron IPC bridge exposed via preload.ts
interface ElectronAPI {
  openFileDialog: (options?: any) => Promise<{ canceled: boolean; filePaths: string[] }>;
  copyFileToLocal: (sourcePath: string) => Promise<{ localPath: string; fileName: string; size: number }>;
  deleteLocalFile: (filePath: string) => Promise<boolean>;
  deleteAllLocalFiles: () => Promise<boolean>;
  fileExists: (filePath: string) => Promise<boolean>;
  readFileBase64: (filePath: string) => Promise<string | null>;
  getAppPath: (name: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getYouTubeInfo: (url: string) => Promise<{ title: string; author_name: string; thumbnail_url: string } | null>;
  getUrlTitle: (url: string) => Promise<string>;
  convertDocxToHtml: (filePath: string) => Promise<{ success: boolean; path?: string; errorType?: string; errorMessage?: string }>;

  // Vault storage — file size & hash
  getFileSize: (filePath: string) => Promise<number>;
  hashFile: (filePath: string) => Promise<string | null>;

  // Vault storage — trash
  moveToTrash: (filePath: string) => Promise<{ trashPath: string } | null>;
  restoreFromTrash: (trashPath: string, localPath: string) => Promise<{ success: boolean; errorCode?: string; errorMessage?: string }>;
  purgeTrash: (olderThanDays?: number) => Promise<{ filesDeleted: number; rowsDeleted: number }>;

  // Vault storage — reconciliation
  reconcileVault: (localPaths: string[]) => Promise<{ present: string[]; missing: string[] }>;

  // Vault storage — export
  exportZip: (
    savePath: string,
    files: Array<{ localPath: string; archiveName: string }>,
    manifestJson: string
  ) => Promise<{ success: boolean; error?: string }>;
  showSaveDialog: (options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ filePath?: string }>;
  showErrorBox: (title: string, content: string) => Promise<void>;
  showMessageBox: (options: any) => Promise<any>;

  // Browser controls
  clearBrowserCache: () => Promise<{ success: boolean; error?: string }>;
  openDevTools: () => Promise<void>;

  // SearXNG PDF search
  searxngSearch: (query: string, customInstance?: string) => Promise<{
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
  }>;

  // PDF download & save
  downloadPdf: (url: string, fileName: string) => Promise<{
    success: boolean;
    localPath?: string;
    fileName?: string;
    size?: number;
    error?: string;
  }>;

  isElectron: boolean;
  platform: string;

  // Profile identity
  profilesGetAll: () => Promise<Array<{ id: string; name: string; avatarPath?: string }>>;
  profilesGetCurrentId: () => Promise<string | null>;
  profilesSetCurrentId: (id: string) => Promise<void>;

  // PIN config
  getPin: () => Promise<{ hash: string; salt: string; enabled: boolean } | null>;
  setPin: (config: { hash: string; salt: string; enabled: boolean } | null) => Promise<void>;

  // Professor / Document Intelligence
  professorGetIngestionStatus: (materialId: string) => Promise<string>;
  professorGetRelevantChunks: (materialId: string, page: number, query: string) => Promise<any[]>;
  professorClassifyAndRetrieve: (materialId: string, page: number, numPages: number, query: string, conversationHistory: any[]) => Promise<{
    intent: string;
    relevantChunks: any[];
    conceptIndex: any | null;
    metrics?: any;
  }>;
  professorGetConceptIndex: (materialId: string) => Promise<any>;
  professorStoreConceptIndex: (materialId: string, indexJson: any) => Promise<void>;
  professorSaveSession: (materialId: string, session: any) => Promise<void>;
  professorLoadSession: (materialId: string) => Promise<any>;

  // Annotations (SQLite-backed)
  professorGetAnnotations: (materialId: string, page?: number) => Promise<any[]>;
  professorSaveAnnotation: (annotation: any) => Promise<{ success: boolean }>;
  professorDeleteAnnotation: (annotationId: string) => Promise<{ success: boolean }>;
  professorDeleteAnnotationsForPage: (materialId: string, page: number) => Promise<{ success: boolean }>;

  // PDF Bookmarks (SQLite-backed)
  professorGetPdfBookmarks: (materialId: string) => Promise<any[]>;
  professorSavePdfBookmark: (bookmark: any) => Promise<{ success: boolean }>;
  professorDeletePdfBookmark: (bookmarkId: string) => Promise<{ success: boolean }>;

  // Re-ingestion
  professorClearIngestion: (materialId: string) => Promise<{ success: boolean }>;

  // Auto-updater
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  quitAndInstall: () => Promise<void>;

  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    // YouTube IFrame API
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export {};
