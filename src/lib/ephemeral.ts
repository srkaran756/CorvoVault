import { AppProfile, AppNotification, Activity } from '../types';

// ─── Storage Keys ─────────────────────────────────────────────────────────────
// These are INTENTIONALLY ephemeral: notifications, activities, and tab/library
// UI state. They do not need to survive a DB rebuild; they're convenience-only.
// Everything identity/settings/content is in SQLite.

const KEYS = {
  UI_STATE:      (profileId: string) => `sic_uistate_${profileId}`,
  NOTIFICATIONS: (profileId: string) => `sic_notifications_${profileId}`,
  ACTIVITIES:    (profileId: string) => `sic_activities_${profileId}`,
};

// ─── Generic helpers ──────────────────────────────────────────────────────────

function get<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[Ephemeral] Failed to save key "${key}":`, err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const ephemeral = {
  // ─── Ephemeral Library UI state ──────────────────────────────────────────────
  getLibraryUIState: (profileId: string): { selectedTopicId: string | null; selectedFolderId: string | null; searchQuery: string } => {
    return get(KEYS.UI_STATE(profileId), {
      selectedTopicId: null,
      selectedFolderId: null,
      searchQuery: '',
    });
  },
  saveLibraryUIState: (profileId: string, state: { selectedTopicId: string | null; selectedFolderId: string | null; searchQuery: string }) => {
    set(KEYS.UI_STATE(profileId), state);
  },

  // ─── Notifications ───────────────────────────────────────────────────────────
  getNotifications: (profileId: string): AppNotification[] =>
    get<AppNotification[]>(KEYS.NOTIFICATIONS(profileId), []),

  saveNotifications: (profileId: string, notifications: AppNotification[]) =>
    set(KEYS.NOTIFICATIONS(profileId), notifications),

  addNotification: (profileId: string, notification: Omit<AppNotification, 'id' | 'time' | 'read'>) => {
    const existing = get<AppNotification[]>(KEYS.NOTIFICATIONS(profileId), []);
    const newNotif: AppNotification = {
      ...notification,
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      read: false,
    };
    const updated = [newNotif, ...existing].slice(0, 50); // max 50
    set(KEYS.NOTIFICATIONS(profileId), updated);
    return newNotif;
  },

  // ─── Activities ──────────────────────────────────────────────────────────────
  getActivities: (profileId: string): Activity[] =>
    get<Activity[]>(KEYS.ACTIVITIES(profileId), []),

  saveActivities: (profileId: string, activities: Activity[]) =>
    set(KEYS.ACTIVITIES(profileId), activities),

  addActivity: (profileId: string, activity: Omit<Activity, 'id' | 'time'>) => {
    const existing = get<Activity[]>(KEYS.ACTIVITIES(profileId), []);
    const newActivity: Activity = {
      ...activity,
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
    };
    const updated = [newActivity, ...existing].slice(0, 100); // max 100
    set(KEYS.ACTIVITIES(profileId), updated);
    return newActivity;
  },

  // ─── Profile data cleanup ────────────────────────────────────────────────────
  clearProfileData: (profileId: string) => {
    localStorage.removeItem(KEYS.UI_STATE(profileId));
    localStorage.removeItem(KEYS.NOTIFICATIONS(profileId));
    localStorage.removeItem(KEYS.ACTIVITIES(profileId));
  },
};
