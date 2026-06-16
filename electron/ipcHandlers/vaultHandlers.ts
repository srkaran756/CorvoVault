import { app, ipcMain, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { ServiceHost } from '../ServiceHost';
import { enqueueDocxConversion } from '../infrastructure/docxPreview';
import { AppEvents } from '../../src/events/AppEvents';
import { vaultSearchArgsSchema } from '../../shared/ipc/schemas';
import { ipcErr, ipcOk } from '../../shared/ipc/envelope';

async function moveVaultFileToTrash(localPath?: string): Promise<string | undefined> {
  if (!localPath || !fs.existsSync(localPath)) return undefined;

  const trashDir = path.join(app.getPath('userData'), 'local-files', '.trash');
  await fs.promises.mkdir(trashDir, { recursive: true });

  const trashPath = path.join(trashDir, `${Date.now()}_${path.basename(localPath)}`);
  try {
    await fs.promises.rename(localPath, trashPath);
  } catch (err: any) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(localPath, trashPath);
    await fs.promises.unlink(localPath);
  }

  return trashPath;
}

async function restoreVaultFile(trashPath?: string, localPath?: string): Promise<void> {
  if (!trashPath || !localPath) return;
  if (!fs.existsSync(trashPath)) {
    if (fs.existsSync(localPath)) return;
    throw new Error('The file is no longer present in the trash folder.');
  }

  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  try {
    await fs.promises.rename(trashPath, localPath);
  } catch (err: any) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(trashPath, localPath);
    await fs.promises.unlink(trashPath);
  }
}

async function deleteVaultFiles(paths: Array<string | undefined>): Promise<void> {
  for (const filePath of Array.from(new Set(paths.filter(Boolean)))) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      console.warn('[Vault] Failed to delete vault file:', filePath, err);
    }
  }
}

export function registerVaultHandlers(db: Database.Database, serviceHost: ServiceHost) {
  // ─── Profile identity (SQLite-backed) ──────────────────────────────────────

  ipcMain.handle('profiles:getAll', () => {
    return db.prepare(
      'SELECT id, name, avatar_path as avatarPath FROM profiles ORDER BY created_at ASC'
    ).all();
  });

  ipcMain.handle('profiles:getCurrentId', () => {
    const row = db.prepare(
      'SELECT id FROM profiles WHERE current = 1 LIMIT 1'
    ).get() as { id: string } | undefined;
    return row?.id ?? null;
  });

  ipcMain.handle('profiles:setCurrentId', (_event, id: string) => {
    db.transaction(() => {
      db.prepare('UPDATE profiles SET current = 0').run();
      db.prepare('UPDATE profiles SET current = 1 WHERE id = ?').run(id);
    })();
  });

  // ─── PIN config — stored encrypted via Electron safeStorage ──────────────
  // safeStorage uses DPAPI on Windows, Keychain on macOS — the encrypted blob
  // is only decryptable by the same OS user account.  Falls back to the legacy
  // plain-JSON file (pin_config.json) so existing PINs continue to work.

  const pinFile    = () => path.join(app.getPath('userData'), 'pin_config.json');
  const encPinFile = () => path.join(app.getPath('userData'), 'pin_store.enc');

  function readPinConfig(): { hash: string; salt: string; enabled: boolean } | null {
    // 1. Try safeStorage encrypted file first
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const raw = fs.readFileSync(encPinFile());
        return JSON.parse(safeStorage.decryptString(raw));
      } catch { /* fall through to legacy */ }
    }
    // 2. Legacy plain-JSON fallback (migration path for existing installs)
    try {
      return JSON.parse(fs.readFileSync(pinFile(), 'utf8'));
    } catch {
      return null;
    }
  }

  ipcMain.handle('pin:get', () => {
    const config = readPinConfig();
    if (!config) return null;
    return { enabled: !!config.enabled };
  });

  ipcMain.handle('pin:verify', (_event, pinEntry: string) => {
    const config = readPinConfig();
    if (!config || !config.enabled) return false;
    const computedHash = crypto.createHash('sha256').update(config.salt + pinEntry).digest('hex');
    return computedHash === config.hash;
  });

  ipcMain.handle('pin:set', (_event, param: any) => {
    if (param === null) {
      // Wipe both possible locations
      try { fs.unlinkSync(encPinFile()); } catch { /* already gone */ }
      try { fs.unlinkSync(pinFile()); }    catch { /* already gone */ }
      return;
    }

    let config: { hash: string; salt: string; enabled: boolean };
    if (typeof param === 'string') {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.createHash('sha256').update(salt + param).digest('hex');
      config = { hash, salt, enabled: true };
    } else {
      // Backward compatibility for old client format
      config = param;
    }

    if (safeStorage.isEncryptionAvailable()) {
      // Write encrypted file and delete legacy plain file
      const encrypted = safeStorage.encryptString(JSON.stringify(config));
      fs.writeFileSync(encPinFile(), encrypted);
      try { fs.unlinkSync(pinFile()); } catch { /* no legacy file — that's fine */ }
    } else {
      // OS encryption unavailable (rare edge case) — fall back to plain JSON
      console.warn('[PIN] safeStorage unavailable — storing PIN config as plain JSON (fallback)');
      fs.writeFileSync(pinFile(), JSON.stringify(config), 'utf8');
    }
  });

  // ─── Vault: profiles sync ──────────────────────────────────────────────────

  ipcMain.handle('profiles:syncAll', async (_, profiles) => serviceHost.vault.syncProfiles(profiles || []));

  ipcMain.handle('vault:getMaterials', async (_, folderId, profileId) => serviceHost.vault.getMaterials(folderId, profileId));
  ipcMain.handle('vault:getAllMaterials', async (_, profileId) => serviceHost.vault.getAllMaterials(profileId));
  // Lightweight count query — returns {files, links, youtubes, notes, total} without loading all rows.
  ipcMain.handle('vault:getMaterialCounts', async (_, profileId) => serviceHost.vault.getMaterialCounts(profileId));
  ipcMain.handle('vault:getTrashed', async (_, profileId) => serviceHost.vault.getTrashed(profileId));

  ipcMain.handle('vault:searchMaterials', async (_, profileId: unknown, query: unknown) => {
    const parsed = vaultSearchArgsSchema.safeParse([profileId, query]);
    if (!parsed.success) {
      return ipcErr('INVALID_INPUT', parsed.error.message || 'Invalid search arguments');
    }
    const [pid, q] = parsed.data;
    const materials = await serviceHost.vault.searchMaterials(pid, q);
    return ipcOk(materials);
  });

  // FIX: Handle ALL material types uniformly via capture()
  ipcMain.handle('vault:capture', async (event, type, data) => {
    const material = await serviceHost.vault.capture(type, data);
    if (material && event.sender) {
      event.sender.send(AppEvents.MATERIAL_CREATED, material);
    }

    // Queue ingestion for files immediately after import
    if (material && material.boxType === 'file' && material.localPath) {
      const ext = path.extname(material.localPath).toLowerCase();
      if (ext === '.pdf') {
        console.log(`[Vault] Queuing professor ingestion for ${material.id}`);
        serviceHost.ingestionQueue.enqueue(material.id, material.localPath, 0);
      } else if (['.docx', '.doc', '.odt', '.rtf'].includes(ext)) {
        console.log(`[Vault] Converting document ${material.localPath} for professor ingestion...`);
        enqueueDocxConversion(material.localPath).then((res: any) => {
          if (res && res.success && res.path) {
            console.log(`[Vault] Conversion succeeded. Queuing professor ingestion for ${material.id} using cached PDF: ${res.path}`);
            serviceHost.ingestionQueue.enqueue(material.id, res.path, 0);
          } else {
            console.error(`[Vault] Failed to convert document ${material.localPath} for ingestion:`, res?.errorMessage || 'Unknown error');
          }
        }).catch(err => {
          console.error(`[Vault] Error during document conversion for ingestion:`, err);
        });
      }
    }

    return material;
  });

  // Keep the file vault and SQLite state in lockstep.
  ipcMain.handle('vault:trashMaterial', async (event, id, profileId) => {
    const material = await serviceHost.vault.getMaterial(id);
    const trashPath = await moveVaultFileToTrash(material?.localPath);
    serviceHost.vault.moveMaterialToTrash(id, profileId, trashPath);
    if (event.sender) event.sender.send(AppEvents.MATERIAL_TRASHED, id);
  });

  ipcMain.handle('vault:restoreMaterial', async (event, id, profileId) => {
    const material = await serviceHost.vault.getMaterial(id);
    await restoreVaultFile(material?.trashPath, material?.localPath);
    serviceHost.vault.restoreMaterial(id, profileId);
    if (event.sender) event.sender.send(AppEvents.MATERIAL_RESTORED, id);
  });







  // Expose getTrashPath so renderer can perform physical file restore via Electron IPC

  ipcMain.handle('vault:getTrashPath', async (_, id) => serviceHost.vault.getTrashPath(id));

  ipcMain.handle('vault:deleteMaterial', async (event, id) => {
    const material = await serviceHost.vault.getMaterial(id);
    await deleteVaultFiles([material?.trashPath, material?.localPath]);
    await serviceHost.vault.permanentlyDelete(id);
    if (event.sender) event.sender.send(AppEvents.MATERIAL_DELETED, id);
  });

  // Topics
  ipcMain.handle('topics:getAll', async (_, profileId) => serviceHost.vault.getTopics(profileId));
  ipcMain.handle('topics:create', async (event, profileId, name) => {
    const topic = await serviceHost.vault.createTopic(profileId, name);
    if (event.sender) event.sender.send(AppEvents.TOPIC_CREATED, topic);
    return topic;
  });
  ipcMain.handle('topics:update', async (_, id, name) => serviceHost.vault.updateTopic(id, name));
  ipcMain.handle('topics:delete', async (event, id) => {
    await serviceHost.vault.deleteTopic(id);
    if (event.sender) event.sender.send(AppEvents.TOPIC_DELETED, id);
  });

  // Folders
  ipcMain.handle('folders:getAll', async (_, topicId) => serviceHost.vault.getFolders(topicId));
  ipcMain.handle('folders:getAllByProfile', async (_, profileId) => serviceHost.vault.getFoldersByProfile(profileId));
  ipcMain.handle('folders:create', async (event, topicId, profileId, name) => {
    const folder = await serviceHost.vault.createFolder(topicId, profileId, name);
    if (event.sender) event.sender.send(AppEvents.FOLDER_CREATED, folder);
    return folder;
  });
  ipcMain.handle('folders:update', async (_, id, name) => serviceHost.vault.updateFolder(id, name));
  ipcMain.handle('folders:delete', async (event, id) => {
    await serviceHost.vault.deleteFolder(id);
    if (event.sender) event.sender.send(AppEvents.FOLDER_DELETED, id);
  });

  // Notes
  ipcMain.handle('notes:getAll', async (_, materialId) => serviceHost.vault.getNotes(materialId));
  ipcMain.handle('notes:add', async (_, materialId, content) => serviceHost.vault.addNote(materialId, content));
  ipcMain.handle('notes:update', async (_, id, content) => serviceHost.vault.updateNote(id, content));
  ipcMain.handle('notes:delete', async (_, id) => serviceHost.vault.deleteNote(id));

  // Video Progress
  ipcMain.handle('vault:getVideoProgress', async (_, materialId) => serviceHost.vault.getVideoProgress(materialId));
  ipcMain.handle('vault:saveVideoProgress', async (_, progress) => serviceHost.vault.saveVideoProgress(progress));

  // Bookmarks
  ipcMain.handle('bookmarks:getAll', async (_, profileId) => serviceHost.vault.getBookmarks(profileId));
  ipcMain.handle('bookmarks:add', async (_, profileId, title, url) => serviceHost.vault.addBookmark(profileId, title, url));
  ipcMain.handle('bookmarks:delete', async (_, id) => serviceHost.vault.deleteBookmark(id));

  // Admin / Export
  ipcMain.handle('vault:purgeProfile', async (_, profileId) => {
    const materials = await serviceHost.vault.getMaterialsByProfile(profileId);
    await deleteVaultFiles(materials.flatMap((material: any) => [material.trash_path, material.local_path]));
    serviceHost.vault.purgeProfile(profileId);
  });
  ipcMain.handle('vault:runIntegrityCheck', async (_, profileId) => serviceHost.vault.runIntegrityCheck(profileId));
  ipcMain.handle('vault:exportJSON', async (_, profileId) => {
    const topics = await serviceHost.vault.getTopics(profileId);
    const materials = await serviceHost.vault.getMaterialsByProfile(profileId);
    return {
      exportVersion: 2,
      exportedAt: new Date().toISOString(),
      profileId,
      topics,
      materials
    };
  });
}
