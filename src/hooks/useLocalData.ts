import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Topic, Folder, Material, UserStats, MaterialNote, VideoProgress } from '../types';
import { ipcService } from '../services/ipcService';

// ─── Topics ──────────────────────────────────────────────────

export function useTopics() {
  const { user } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    ipcService.topics.getAll(user.id).then(data => {
      setTopics(data);
      setLoading(false);
    });
  }, [user]);

  const addTopic = useCallback(async (name: string) => {
    if (!user) return;
    const newTopic = await ipcService.topics.create(user.id, name);
    setTopics(prev => [newTopic, ...prev]);
    return newTopic;
  }, [user]);

  const renameTopic = useCallback(async (id: string, newName: string) => {
    await ipcService.topics.update(id, newName);
    setTopics(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
  }, []);

  const deleteTopic = useCallback(async (id: string) => {
    if (!user) return;
    await ipcService.topics.delete(id);
    setTopics(prev => prev.filter(t => t.id !== id));
  }, [user]);

  return { topics, loading, addTopic, renameTopic, deleteTopic };
}

// ─── Folders ─────────────────────────────────────────────────

export function useFolders(topicId?: string) {
  const { user } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!user) return;
    if (topicId) {
      ipcService.folders.getAll(topicId).then(data => {
        setFolders(data);
        setLoading(false);
      });
    } else {
      // No topicId — fetch all folders for this profile (e.g., for a global move dialog)
      ipcService.folders.getAllByProfile(user.id).then(data => {
        setFolders(data ?? []);
        setLoading(false);
      });
    }
  }, [user, topicId]);

  useEffect(() => { reload(); }, [reload]);

  const addFolder = useCallback(async (name: string, parentTopicId: string) => {
    if (!user) return;
    const newFolder = await ipcService.folders.create(parentTopicId, user.id, name);
    if (!topicId || newFolder.topicId === topicId) {
      setFolders(prev => [newFolder, ...prev]);
    }
    return newFolder;
  }, [user, topicId]);

  const renameFolder = useCallback(async (id: string, newName: string) => {
    await ipcService.folders.update(id, newName);
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newName } : f));
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    if (!user) return;
    await ipcService.folders.delete(id);
    setFolders(prev => prev.filter(f => f.id !== id));
  }, [user]);

  return { folders, loading, addFolder, renameFolder, deleteFolder, reload };
}

// ─── Materials ───────────────────────────────────────────────

export function useMaterials(folderId?: string, includeTrashed: boolean = false) {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!user) return;
    if (includeTrashed) {
      ipcService.vault.getTrashed(user.id).then(data => {
        setMaterials(data);
        setLoading(false);
      });
    } else if (folderId) {
      ipcService.vault.getMaterials(folderId, user.id).then(data => {
        setMaterials(data);
        setLoading(false);
      });
    } else {
      ipcService.vault.getAllMaterials(user.id).then(data => {
        setMaterials(data);
        setLoading(false);
      });
    }
  }, [user, folderId, includeTrashed]);

  useEffect(() => { reload(); }, [reload]);

  const addMaterial = useCallback(async (material: Omit<Material, 'id' | 'profileId' | 'createdAt'>) => {
    if (!user) return;
    const newMaterial = await ipcService.vault.capture(material.boxType, { ...material, profileId: user.id });
    if (!folderId || newMaterial.folderId === folderId) {
      setMaterials(prev => [newMaterial, ...prev]);
    }
    return newMaterial;
  }, [user, folderId]);

  const deleteMaterial = useCallback(async (id: string) => {
    if (!user) return;
    await ipcService.vault.trashMaterial(id, user.id);
    setMaterials(prev => prev.filter(m => m.id !== id));
  }, [user]);

  const restoreMaterial = useCallback(async (id: string): Promise<{ success: boolean; error?: string } | undefined> => {
    if (!user) return;
    try {
      await ipcService.vault.restoreMaterial(id, user.id);
      reload();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user, reload]);

  const permanentlyDeleteMaterial = useCallback(async (id: string) => {
    if (!user) return;
    await ipcService.vault.deleteMaterial(id);
    reload();
    return true;
  }, [user, reload]);

  return { materials, loading, addMaterial, deleteMaterial, restoreMaterial, permanentlyDeleteMaterial, reload };
}

// ─── User Stats ──────────────────────────────────────────────

let globalStats: UserStats | null = null;
let loadingPromise: Promise<UserStats> | null = null;   // guard against parallel fetches
const statsListeners = new Set<(stats: UserStats | null) => void>();

function notifyAll(stats: UserStats | null) {
  globalStats = stats;
  statsListeners.forEach(fn => fn(stats));
}

export function useUserStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(globalStats);

  useEffect(() => {
    if (!user) {
      globalStats = null;
      loadingPromise = null;
      statsListeners.forEach(fn => fn(null));
      return;
    }

    // Reset if profile switched
    if (globalStats && globalStats.profileId !== user.id) {
      globalStats = null;
      loadingPromise = null;
    }

    // Register listener FIRST so we don't miss any notify calls
    const listener = (newStats: UserStats | null) => setStats(newStats);
    statsListeners.add(listener);

    if (globalStats) {
      // Already loaded — push current value immediately
      setStats(globalStats);
    } else if (!loadingPromise) {
      // Start a single in-flight fetch; all concurrent callers share it
      loadingPromise = ipcService.settings.getStats(user.id).then((data: UserStats) => {
        loadingPromise = null;
        notifyAll(data);
        return data;
      });
    }
    // If loadingPromise is already in-flight, just wait for the notify

    return () => {
      statsListeners.delete(listener);
    };
  }, [user]);

  const updateStats = useCallback(async (updates: Partial<UserStats>) => {
    if (!user) return;

    // If still loading, await it first to get a valid base
    const baseStats = globalStats
      ?? (loadingPromise ? await loadingPromise : await ipcService.settings.getStats(user.id));

    const newStats = { ...baseStats, ...updates, lastActiveAt: new Date().toISOString() };
    notifyAll(newStats);
    await ipcService.settings.saveStats(user.id, newStats);
  }, [user]);

  return { stats, updateStats };
}

// ─── User Settings ───────────────────────────────────────────

export function useUserSettings() {
  const { settings, updateSettings } = useAuth();
  return { settings, updateSettings };
}

// ─── Notes ───────────────────────────────────────────────────

export function useMaterialNotes(materialId: string) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<MaterialNote[]>([]);

  useEffect(() => {
    if (!user || !materialId) return;
    ipcService.notes.getAll(materialId).then(setNotes);
  }, [user, materialId]);

  const addNote = useCallback(async (content: string) => {
    if (!user) return;
    const note = await ipcService.notes.add(materialId, content);
    setNotes(prev => [...prev, note]);
    return note;
  }, [user, materialId]);

  const updateNote = useCallback(async (noteId: string, content: string) => {
    if (!user) return;
    await ipcService.notes.update(noteId, content);
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content, updatedAt: new Date().toISOString() } : n));
  }, [user]);

  const deleteNote = useCallback(async (noteId: string) => {
    if (!user) return;
    await ipcService.notes.delete(noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, [user]);

  return { notes, addNote, updateNote, deleteNote };
}

// ─── Video Progress ──────────────────────────────────────────

export function useVideoProgress(materialId: string) {
  const { user } = useAuth();
  const [progress, setProgress] = useState<VideoProgress | null>(null);

  useEffect(() => {
    if (!user || !materialId) return;
    ipcService.vault.getVideoProgress(materialId).then(setProgress);
  }, [user, materialId]);

  const updateProgress = useCallback(async (currentTime: number, duration: number) => {
    if (!user || !materialId) return;
    const vp: VideoProgress = {
      materialId,
      profileId: user.id,
      currentTime,
      duration,
      updatedAt: new Date().toISOString()
    };
    await ipcService.vault.saveVideoProgress(vp);
    setProgress(vp);
  }, [user, materialId]);

  return { progress, updateProgress };
}

// ─── Bookmarks ───────────────────────────────────────────────

export function useBookmarks() {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<Array<{id: string, title: string, url: string, createdAt?: string}>>([]);

  useEffect(() => {
    if (!user) return;
    ipcService.bookmarks.getAll(user.id).then(setBookmarks);
  }, [user]);

  const addBookmark = useCallback(async (title: string, url: string) => {
    if (!user) return;
    await ipcService.bookmarks.add(user.id, title, url);
    // One getAll to pick up the DB-generated ID — down from 2 calls previously.
    const updated = await ipcService.bookmarks.getAll(user.id);
    setBookmarks(updated);
  }, [user]);

  const removeBookmark = useCallback(async (bookmarkId: string) => {
    if (!user) return;
    // Optimistic removal — instant UI response, no refetch needed.
    setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
    ipcService.bookmarks.delete(bookmarkId).catch(err => {
      // Rollback on failure by re-fetching.
      console.error('[Bookmarks] Delete failed, re-syncing:', err);
      ipcService.bookmarks.getAll(user.id).then(setBookmarks);
    });
  }, [user]);


  return { bookmarks, addBookmark, removeBookmark };
}

// ─── Material Counts (lightweight stats) ─────────────────────
// Returns per-box-type counts via a single SQL GROUP BY query.
// Use this instead of useMaterials() when you only need numbers, not full data.

export interface MaterialCounts {
  files: number;
  links: number;
  youtubes: number;
  notes: number;
  total: number;
}

const EMPTY_COUNTS: MaterialCounts = { files: 0, links: 0, youtubes: 0, notes: 0, total: 0 };

export function useMaterialCounts() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<MaterialCounts>(EMPTY_COUNTS);

  const refresh = useCallback(() => {
    if (!user) return;
    ipcService.vault.getMaterialCounts(user.id).then(data => {
      if (data) setCounts(data as MaterialCounts);
    });
  }, [user]);

  // Initial fetch
  useEffect(() => {
    if (!user) { setCounts(EMPTY_COUNTS); return; }
    refresh();
  }, [user, refresh]);

  // Re-fetch whenever the main process pushes a material lifecycle event
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = [
      'material:created',
      'material:trashed',
      'material:restored',
      'material:deleted',
    ].map(channel => window.electronAPI!.on(channel, refresh));

    return () => { unsub.forEach(off => off && off()); };
  }, [refresh]);

  return counts;
}

