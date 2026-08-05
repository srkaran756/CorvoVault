import { app, session, dialog, BrowserWindow, WebContents, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { ServiceHost } from '../ServiceHost';
import { enqueueDocxConversion } from '../infrastructure/docxPreview';
import { computeFileHash, encryptBuffer } from '../utils/cryptoUtils';

interface PendingDownloadEntry {
  item: any;
  webContents: WebContents;
  tempPath: string;
  filename: string;
  url: string;
  resolved?: {
    choice: 'vault' | 'outside' | 'cancel';
    destination?: { topicId: string; folderId: string };
    outsidePath?: string;
  };
  completed?: boolean;
}

const pendingDownloads = new Map<string, PendingDownloadEntry>();

let activeDb: Database.Database | null = null;
let activeServiceHost: ServiceHost | null = null;
let getMainWindowFn: (() => BrowserWindow | null) | null = null;

// Helper to send beautiful formatted logs to terminal and forward them to the UI
function sendDevLog(
  webContents: WebContents,
  downloadId: string,
  step: string,
  message: string,
  status: 'pending' | 'running' | 'success' | 'warn' | 'error' = 'running',
  details?: any
) {
  if (app.isPackaged) return; // Only log in dev mode

  const payload = {
    downloadId,
    timestamp: Date.now(),
    step,
    message,
    status,
    details
  };

  // Color logs in development terminal
  const colorReset = '\x1b[0m';
  const colors = {
    pending: '\x1b[36m', // Cyan
    running: '\x1b[35m', // Magenta
    success: '\x1b[32m', // Green
    warn: '\x1b[33m',    // Yellow
    error: '\x1b[31m',   // Red
  };
  const color = colors[status] || colorReset;
  console.log(`${color}[DevDownload] [${step.toUpperCase()}] (${status.toUpperCase()}) ${message}${colorReset}`, details ? '\n' + JSON.stringify(details, null, 2) : '');

  try {
    webContents.send('download:dev-log', payload);
  } catch (err) {
    console.error('[Download] Failed to send dev log to webContents:', err);
  }
}

async function finalizeDownload(
  db: Database.Database,
  serviceHost: ServiceHost,
  getMainWindow: () => BrowserWindow | null,
  downloadId: string,
  entry: PendingDownloadEntry
) {
  const { webContents, tempPath, filename, url, resolved } = entry;

  if (!resolved) return;

  if (resolved.choice === 'cancel') {
    if (fs.existsSync(tempPath)) {
      fs.unlink(tempPath, () => {});
    }
    return;
  }

  if (resolved.choice === 'outside') {
    const dest = resolved.outsidePath;
    if (!dest) {
      if (fs.existsSync(tempPath)) {
        fs.unlink(tempPath, () => {});
      }
      return;
    }
    try {
      sendDevLog(webContents, downloadId, 'finalize', `Moving file to outside location: ${dest}`, 'running');
      // Ensure target directory exists
      const targetDir = path.dirname(dest);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(tempPath, dest);
      fs.unlinkSync(tempPath);
      sendDevLog(webContents, downloadId, 'download-done', `File downloaded successfully outside the vault. Location: ${dest}`, 'success', { path: dest });
      getMainWindow()?.webContents.send('download:completed', { filename, success: true });
    } catch (err: any) {
      console.error('[Download] Failed to save outside:', err);
      sendDevLog(webContents, downloadId, 'finalize', `Error moving file: ${err.message}`, 'error');
      if (fs.existsSync(tempPath)) {
        fs.unlink(tempPath, () => {});
      }
      getMainWindow()?.webContents.send('download:completed', { filename, success: false, error: err.message });
    }
    return;
  }

  if (resolved.choice === 'vault') {
    try {
      const userDataPath = app.getPath('userData');
      const filesDir = path.join(userDataPath, 'local-files');
      if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
      }
      const safeName = filename.replace(/[^a-zA-Z0-9_\-. ]/g, '_').substring(0, 120);
      const destPath = path.join(filesDir, `${Date.now()}_${safeName}`);

      sendDevLog(webContents, downloadId, 'finalize', `Moving file to vault path: ${destPath}`, 'running');
      const raw = fs.readFileSync(tempPath);
      const encrypted = encryptBuffer(raw);
      fs.writeFileSync(destPath, encrypted);
      fs.unlinkSync(tempPath);

      // 1. Get current profile ID
      sendDevLog(webContents, downloadId, 'vault-db', 'Querying SQLite for currently active profile ID...', 'running');
      const profileRow = db.prepare('SELECT id FROM profiles WHERE current = 1 LIMIT 1').get() as { id: string } | undefined;
      if (!profileRow) {
        console.error('No active profile found for download');
        sendDevLog(webContents, downloadId, 'vault-db', 'Abort: No active profile found in SQLite database.', 'error');
        getMainWindow()?.webContents.send('download:completed', { filename, success: false, error: 'No active profile found' });
        return;
      }
      const profileId = profileRow.id;
      sendDevLog(webContents, downloadId, 'vault-db', `Profile ID found: ${profileId}`, 'running', { profileId });

      let topicId = resolved.destination?.topicId;
      let folderId = resolved.destination?.folderId;

      // If destination is not defined, resolve default 'Downloads' topic & folder
      if (!topicId || !folderId) {
        sendDevLog(webContents, downloadId, 'vault-db', "No destination specified. Resolving default 'Downloads' topic & folder...", 'running');
        // Find or create "Downloads" topic
        let topicRow = db.prepare('SELECT id FROM topics WHERE profile_id = ? AND name = ? LIMIT 1').get(profileId, 'Downloads') as { id: string } | undefined;
        if (!topicRow) {
          topicId = crypto.randomUUID();
          db.prepare('INSERT INTO topics (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)').run(
            topicId,
            profileId,
            'Downloads',
            Date.now()
          );
          sendDevLog(webContents, downloadId, 'vault-db', `Created default 'Downloads' topic in database. ID: ${topicId}`, 'running');
          getMainWindow()?.webContents.send('topic:created', { id: topicId, profileId, name: 'Downloads', createdAt: new Date().toISOString(), resourceCount: 0, activeNotes: 0 });
        } else {
          topicId = topicRow.id;
          sendDevLog(webContents, downloadId, 'vault-db', `Using existing default 'Downloads' topic. ID: ${topicId}`, 'running');
        }

        // Find or create "Downloads" folder
        let folderRow = db.prepare('SELECT id FROM folders WHERE topic_id = ? AND profile_id = ? AND name = ? LIMIT 1').get(topicId, profileId, 'Downloads') as { id: string } | undefined;
        if (!folderRow) {
          folderId = crypto.randomUUID();
          db.prepare('INSERT INTO folders (id, topic_id, profile_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
            folderId,
            topicId,
            profileId,
            'Downloads',
            Date.now()
          );
          sendDevLog(webContents, downloadId, 'vault-db', `Created default 'Downloads' folder in database. ID: ${folderId}`, 'running');
          getMainWindow()?.webContents.send('folder:created', { id: folderId, topicId, profileId, name: 'Downloads', createdAt: new Date().toISOString() });
        } else {
          folderId = folderRow.id;
          sendDevLog(webContents, downloadId, 'vault-db', `Using existing default 'Downloads' folder. ID: ${folderId}`, 'running');
        }
      } else {
        sendDevLog(webContents, downloadId, 'vault-db', `Using custom destination. Topic ID: ${topicId}, Folder ID: ${folderId}`, 'running');
      }

      // 4. Compute file stats & hash
      sendDevLog(webContents, downloadId, 'vault-db', 'Computing file statistics and MD5 integrity checksum hash...', 'running');
      const stats = fs.statSync(destPath);
      const fileHash = await computeFileHash(destPath);
      sendDevLog(webContents, downloadId, 'vault-db', `File statistics loaded. Size: ${stats.size} bytes. MD5: ${fileHash}`, 'running', { size: stats.size, hash: fileHash });

      // 5. Insert material row into database
      const materialId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const createdAtMs = Date.now();

      sendDevLog(webContents, downloadId, 'vault-db', `Writing SQLite record to 'materials' table. Material ID: ${materialId}`, 'running');
      db.prepare(`
        INSERT INTO materials (
          id, folder_id, profile_id, box_type, title, url, 
          local_path, storage_status, file_hash, file_size, created_at
        ) VALUES (
          ?, ?, ?, 'file', ?, ?, 
          ?, 'active', ?, ?, ?
        )
      `).run(
        materialId,
        folderId,
        profileId,
        filename,
        url,
        destPath,
        fileHash || null,
        stats.size,
        createdAtMs
      );

      sendDevLog(webContents, downloadId, 'vault-db', `SQLite transaction succeeded. Material record saved.`, 'success', { materialId });

      const material = {
        id: materialId,
        folderId,
        topicId,
        profileId,
        boxType: 'file',
        title: filename,
        url: url,
        localPath: destPath,
        storageStatus: 'active',
        fileHash,
        fileSizeBytes: stats.size,
        createdAt
      };

      // Notify renderer of the new material
      getMainWindow()?.webContents.send('material:created', material);
      getMainWindow()?.webContents.send('app:event', { type: 'MATERIAL_CREATED', payload: material });
      getMainWindow()?.webContents.send('download:completed', { filename, success: true });

      // Enqueue for ingestion/RAG indexing
      sendDevLog(webContents, downloadId, 'vault-ingestion', `Checking file extension for text extraction and indexing...`, 'running');
      const ext = path.extname(destPath).toLowerCase();
      if (ext === '.pdf') {
        sendDevLog(webContents, downloadId, 'vault-ingestion', `PDF file detected. Queuing ingestion for RAG processing...`, 'running');
        console.log(`[Vault] Queuing professor ingestion for ${materialId}`);
        serviceHost.ingestionQueue.enqueue(materialId, destPath, 0);
        sendDevLog(webContents, downloadId, 'vault-ingestion', `Enqueued PDF ingestion task in ServiceHost. ID: ${materialId}`, 'success');
      } else if (['.docx', '.doc', '.odt', '.rtf'].includes(ext)) {
        sendDevLog(webContents, downloadId, 'vault-ingestion', `Word document (${ext}) detected. Initiating Docx-to-PDF conversion first...`, 'running');
        console.log(`[Vault] Converting document ${destPath} for professor ingestion...`);
        enqueueDocxConversion(destPath).then((res: any) => {
          if (res && res.success && res.path) {
            console.log(`[Vault] Conversion succeeded. Queuing professor ingestion for ${materialId} using cached PDF: ${res.path}`);
            sendDevLog(webContents, downloadId, 'vault-ingestion', `Conversion succeeded. Enqueuing PDF for RAG ingestion. Path: ${res.path}`, 'running');
            serviceHost.ingestionQueue.enqueue(materialId, res.path, 0);
            sendDevLog(webContents, downloadId, 'vault-ingestion', `Enqueued converted document ingestion task. ID: ${materialId}`, 'success');
          } else {
            console.error(`[Vault] Failed to convert document ${destPath} for ingestion:`, res?.errorMessage || 'Unknown error');
            sendDevLog(webContents, downloadId, 'vault-ingestion', `Conversion failed: ${res?.errorMessage || 'Unknown error'}`, 'error');
          }
        }).catch(err => {
          console.error(`[Vault] Error during document conversion for ingestion:`, err);
          sendDevLog(webContents, downloadId, 'vault-ingestion', `Conversion error: ${err.message}`, 'error');
        });
      } else {
        sendDevLog(webContents, downloadId, 'vault-ingestion', `File extension ${ext} is not supported for text ingestion (only PDF and Word are indexed). Stored in vault successfully.`, 'warn');
      }
    } catch (err: any) {
      console.error('[Download] Failed to save downloaded file to database:', err);
      sendDevLog(webContents, downloadId, 'vault-db', `Error saving file metadata to database: ${err.message}`, 'error');
      getMainWindow()?.webContents.send('download:completed', { filename, success: false, error: err.message });
    }
    return;
  }
}

const handleWillDownload = (event: any, item: any, webContents: WebContents) => {
  if (!activeDb || !activeServiceHost || !getMainWindowFn) {
    console.warn('[Download] Cannot handle download: active handler references are not registered.');
    return;
  }
  const db = activeDb;
  const serviceHost = activeServiceHost;
  const getMainWindow = getMainWindowFn;

  const downloadId = crypto.randomUUID();
  const fileName = item.getFilename();

  sendDevLog(webContents, downloadId, 'will-download', `Intercepted download: ${fileName}`, 'pending', {
    filename: fileName,
    totalBytes: item.getTotalBytes(),
    url: item.getURL(),
    mimeType: item.getMimeType(),
  });

  try {
    // Configure temporary destination path
    const tempDir = path.join(app.getPath('userData'), 'temp-downloads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, `${crypto.randomUUID()}_${fileName}`);

    sendDevLog(webContents, downloadId, 'setup-path', `Temp target path configured: ${tempPath}`, 'running', { path: tempPath });
    item.setSavePath(tempPath);

    // Notify UI download has started
    getMainWindow()?.webContents.send('download:started', { filename: fileName });

    // Store in pending map
    const entry: PendingDownloadEntry = {
      item,
      webContents,
      tempPath,
      filename: fileName,
      url: item.getURL()
    };
    pendingDownloads.set(downloadId, entry);

    item.on('updated', (e: any, state: string) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const percent = total > 0 ? Math.round((received / total) * 100) : 0;
        sendDevLog(webContents, downloadId, 'downloading', `Downloading to temp: ${percent}% (${(received / (1024 * 1024)).toFixed(2)} MB / ${(total / (1024 * 1024)).toFixed(2)} MB)`, 'running', {
          receivedBytes: received,
          totalBytes: total,
          percent
        });
      } else if (state === 'interrupted') {
        sendDevLog(webContents, downloadId, 'downloading', 'Download stream interrupted.', 'warn');
      }
    });

    item.once('done', async (e: any, state: string) => {
      const ent = pendingDownloads.get(downloadId);
      if (!ent) return;

      if (state === 'completed') {
        ent.completed = true;
        sendDevLog(webContents, downloadId, 'download-done', 'File download completed to temp folder.', 'success');
        // If the user already resolved options, finalize now!
        if (ent.resolved) {
          await finalizeDownload(db, serviceHost, getMainWindow, downloadId, ent);
        }
      } else {
        sendDevLog(webContents, downloadId, 'download-done', `File download failed or was interrupted in temp. State: ${state}`, 'error', { state });
        if (fs.existsSync(tempPath)) {
          fs.unlink(tempPath, () => {});
        }
        pendingDownloads.delete(downloadId);
        getMainWindow()?.webContents.send('download:completed', { filename: fileName, success: false, error: `State: ${state}` });
      }
    });

    // Send options request to the frontend main window to show modal
    getMainWindow()?.webContents.send('download:request-options', {
      downloadId,
      filename: fileName,
      totalBytes: item.getTotalBytes()
    });
    sendDevLog(webContents, downloadId, 'request-options', 'Dispatched options prompt request to UI.', 'running');

  } catch (err: any) {
    console.error('[Download] Error setting up temp download:', err);
    sendDevLog(webContents, downloadId, 'setup-path', `Error setting up temp download: ${err.message}`, 'error');
    item.cancel();
    getMainWindow()?.webContents.send('download:completed', { filename: fileName, success: false, error: err.message });
  }
};

export function registerSessionForDownloads(sess: any) {
  sess.on('will-download', handleWillDownload);
}

export function registerDownloadHandler(
  db: Database.Database,
  serviceHost: ServiceHost,
  getMainWindow: () => BrowserWindow | null
) {
  activeDb = db;
  activeServiceHost = serviceHost;
  getMainWindowFn = getMainWindow;

  // Listen for the frontend resolving a download decision
  ipcMain.handle('download:resolve-options', async (_event, { downloadId, choice, destination }) => {
    const entry = pendingDownloads.get(downloadId);
    if (!entry) {
      console.warn(`[Download] Received resolve for unknown downloadId: ${downloadId}`);
      return { success: false, error: 'Download not found' };
    }

    const { item, webContents } = entry;
    sendDevLog(webContents, downloadId, 'resolve-options', `User selected download choice: ${choice}`, 'running', { choice, destination });

    if (choice === 'cancel') {
      try {
        item.cancel();
        sendDevLog(webContents, downloadId, 'cancel', 'Download stream cancelled by user request.', 'warn');
      } catch (err: any) {
        console.error('[Download] Error cancelling item:', err);
      }
      if (fs.existsSync(entry.tempPath)) {
        fs.unlink(entry.tempPath, () => {});
      }
      pendingDownloads.delete(downloadId);
      return { success: true };
    }

    if (choice === 'outside') {
      try {
        sendDevLog(webContents, downloadId, 'setup-path', 'Opening Save Outside native file dialog...', 'running');
        const savePath = dialog.showSaveDialogSync(getMainWindow() || undefined as any, {
          defaultPath: entry.filename,
          title: 'Save File'
        });
        if (savePath) {
          entry.resolved = { choice: 'outside', outsidePath: savePath };
          // If already complete, finalize now
          if (entry.completed) {
            await finalizeDownload(db, serviceHost, getMainWindow, downloadId, entry);
          }
        } else {
          // User closed the dialog, cancel
          item.cancel();
          if (fs.existsSync(entry.tempPath)) {
            fs.unlink(entry.tempPath, () => {});
          }
          pendingDownloads.delete(downloadId);
        }
      } catch (err: any) {
        console.error('[Download] Error in Save Outside dialog:', err);
        item.cancel();
        if (fs.existsSync(entry.tempPath)) {
          fs.unlink(entry.tempPath, () => {});
        }
        pendingDownloads.delete(downloadId);
        return { success: false, error: err.message };
      }
      return { success: true };
    }

    if (choice === 'vault') {
      entry.resolved = { choice: 'vault', destination };
      if (entry.completed) {
        await finalizeDownload(db, serviceHost, getMainWindow, downloadId, entry);
      }
      return { success: true };
    }

    return { success: false, error: 'Unknown choice' };
  });

  // Register on both the default session and the browser session
  session.defaultSession.on('will-download', handleWillDownload);
  const browserSession = session.fromPartition('persist:browser');
  browserSession.on('will-download', handleWillDownload);
}
