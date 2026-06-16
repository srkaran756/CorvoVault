import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppProfile, AppSettings } from '../types';
import { ipcService } from '../services/ipcService';

interface AuthContextType {
  user: AppProfile | null;
  profiles: AppProfile[];
  settings: AppSettings;
  loading: boolean;
  switchProfile: (profileId: string) => void;
  addProfile: (profile: Omit<AppProfile, 'id'>) => void;
  updateProfile: (profile: AppProfile) => void;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS = (profileId: string): AppSettings => ({
  profileId,
  studyTargetMinutes: 240,
  focusTimeMinutes: 25,
});

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<AppProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string>('');
  const [user, setUser] = useState<AppProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS(''));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Guard against React strict mode's double-invocation and stale updates
    let cancelled = false;

    const boot = async () => {
      // ── Dev browser mode (no Electron IPC) ─────────────────────────────────
      if (!window.electronAPI) {
        const fallbackProfile: AppProfile = {
          id: 'default-user',
          name: 'Curator',
          email: '',
          description: 'Default local profile',
          isGuest: false,
        };
        if (!cancelled) {
          setProfiles([fallbackProfile]);
          setCurrentProfileId(fallbackProfile.id);
          setUser(fallbackProfile);
          setSettings(DEFAULT_SETTINGS(fallbackProfile.id));
          setLoading(false);
        }
        return;
      }

      // Declared in the outer scope so the reconciliation block can use them
      // without relying on stale React state (user/profiles still hold initial
      // values at that point because React batches state updates).
      let loadedProfiles: AppProfile[] = [];
      let activeProfile: AppProfile | null = null;

      try {
        // 1. Load profiles + current profile ID from SQLite (parallel)
        const [sqliteProfiles, currentId] = await Promise.all([
          ipcService.profiles.getAll(),
          ipcService.profiles.getCurrentId(),
        ]);

        // Map SQLite row shape → AppProfile
        loadedProfiles = (sqliteProfiles ?? []).map(row => ({
          id: row.id,
          name: row.name,
          email: '',
          photoURL: row.avatarPath ?? undefined,
        }));

        // Fresh install — create a default profile
        if (loadedProfiles.length === 0) {
          const defaultProfile: AppProfile = {
            id: 'default-user',
            name: 'Curator',
            email: '',
            description: 'Default local profile',
            isGuest: false,
          };
          await ipcService.profiles.syncAll([defaultProfile]);
          await ipcService.profiles.setCurrentId(defaultProfile.id);
          loadedProfiles.push(defaultProfile);
        }

        // FIX 1: Persist the auto-selected profile when currentId is null
        // (first boot after migration 004 — every profile defaults to current=0)
        const resolvedCurrentId = currentId ?? loadedProfiles[0].id;
        if (!currentId) {
          // Fire-and-forget — don't block the rest of boot
          ipcService.profiles.setCurrentId(resolvedCurrentId).catch(err =>
            console.warn('[Auth] Failed to persist currentId:', err)
          );
        }

        activeProfile = loadedProfiles.find(p => p.id === resolvedCurrentId) ?? loadedProfiles[0];

        if (cancelled) return;
        setProfiles(loadedProfiles);
        setCurrentProfileId(activeProfile.id);
        setUser(activeProfile);

        // 2. Load settings from SQLite (single source of truth)
        const savedSettings = await ipcService.settings.get(activeProfile.id);
        if (!cancelled) {
          setSettings(savedSettings ?? DEFAULT_SETTINGS(activeProfile.id));
        }

      } catch (err) {
        console.warn('[Auth] Boot failed, using in-memory defaults:', err);
        const fallback: AppProfile = { id: 'default-user', name: 'Curator', email: '' };
        loadedProfiles = [fallback];
        activeProfile = fallback;
        if (!cancelled) {
          setProfiles([fallback]);
          setCurrentProfileId(fallback.id);
          setUser(fallback);
          setSettings(DEFAULT_SETTINGS(fallback.id));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      // 3. Background reconcile: if the current profile has no topics, auto-switch
      //    to whichever profile does (migration helper for renamed/changed profile IDs).
      //    FIX 2: Uses LOCAL variables — not stale React state (user/profiles).
      if (!activeProfile || cancelled) return;
      try {
        const currentTopics = await ipcService.topics.getAll(activeProfile.id);
        if (!currentTopics || currentTopics.length === 0) {
          for (const profile of loadedProfiles) {
            if (profile.id === activeProfile.id) continue;
            const otherTopics = await ipcService.topics.getAll(profile.id);
            if (otherTopics && otherTopics.length > 0) {
              console.log(
                `[Auth] Auto-switching to profile "${profile.name}" (${profile.id}) ` +
                `which has ${otherTopics.length} topic(s) in SQLite.`
              );
              if (cancelled) return;
              await ipcService.profiles.setCurrentId(profile.id);
              const newSettings = await ipcService.settings.get(profile.id);
              if (!cancelled) {
                setCurrentProfileId(profile.id);
                setUser(profile);
                setSettings(newSettings ?? DEFAULT_SETTINGS(profile.id));
              }
              break;
            }
          }
        }
      } catch (err) {
        console.warn('[Auth] Profile reconciliation failed:', err);
      }

      // 4. Fire-and-forget trash purge (old trashed files, configurable retention)
      // Note: activeProfile.id is always available here (set before the try block at line ~100).
      // We re-read settings inline rather than referencing the out-of-scope savedSettings.
      const loadedRetentionDays = await ipcService.settings.get(activeProfile.id)
        .then(s => s?.trashRetentionDays ?? 30)
        .catch(() => 30);
      window.electronAPI?.purgeTrash?.(loadedRetentionDays).catch((err: unknown) =>
        console.warn('[Auth] purgeTrash failed:', err)
      );
    };

    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Profile switching ───────────────────────────────────────────────────────

  const switchProfile = useCallback(async (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    if (window.electronAPI) {
      await ipcService.profiles.setCurrentId(profileId);
    }
    setCurrentProfileId(profileId);
    setUser(profile);

    try {
      const newSettings = await ipcService.settings.get(profileId);
      setSettings(newSettings ?? DEFAULT_SETTINGS(profileId));
    } catch {
      setSettings(DEFAULT_SETTINGS(profileId));
    }
  }, [profiles]);

  // ─── Profile management ──────────────────────────────────────────────────────

  const addProfile = useCallback(async (profileData: Omit<AppProfile, 'id'>) => {
    const newProfile: AppProfile = { ...profileData, id: crypto.randomUUID() };
    const newProfiles = [...profiles, newProfile];
    setProfiles(newProfiles);

    if (window.electronAPI) {
      // syncAll → ensureProfile UPSERT in SQLite (fine — renderer is creating a new row)
      await ipcService.profiles.syncAll(newProfiles);
      await ipcService.profiles.setCurrentId(newProfile.id);
    }

    setCurrentProfileId(newProfile.id);
    setUser(newProfile);
    setSettings(DEFAULT_SETTINGS(newProfile.id));
  }, [profiles]);

  const updateProfile = useCallback(async (updatedProfile: AppProfile) => {
    const newProfiles = profiles.map(p => p.id === updatedProfile.id ? updatedProfile : p);
    setProfiles(newProfiles);

    if (window.electronAPI) {
      // syncAll → UPSERT in SQLite (name / avatarPath update)
      await ipcService.profiles.syncAll(newProfiles);
    }

    if (updatedProfile.id === currentProfileId) {
      setUser(updatedProfile);
    }
  }, [profiles, currentProfileId]);

  // ─── Settings ────────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates, profileId: currentProfileId };
    setSettings(newSettings);
    // SQLite is the single writer — no localStorage
    await ipcService.settings.save(currentProfileId, newSettings);
  }, [settings, currentProfileId]);

  return (
    <AuthContext.Provider value={{
      user, profiles, settings, loading,
      switchProfile, addProfile, updateProfile, updateSettings
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
