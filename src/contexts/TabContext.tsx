import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';


export type TabType = 'today' | 'vault' | 'clip' | 'browser' | 'settings' | 'customize' | 'document' | 'note';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  data?: any;
}

interface TabContextProps {
  tabs: Tab[];
  activeTabId: string | null;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  openTab: (type: TabType, title?: string, data?: any) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setSidebarCollapsed: (val: boolean) => void;
  setRightPanelOpen: (val: boolean) => void;
}

const TabContext = createContext<TabContextProps | undefined>(undefined);

const LOCAL_STORAGE_KEY_TABS_BASE = 'sic_workspace_tabs';
const LOCAL_STORAGE_KEY_ACTIVE_TAB_BASE = 'sic_workspace_active_tab';
const LOCAL_STORAGE_KEY_SIDEBAR_BASE = 'sic_workspace_sidebar_collapsed';
const LOCAL_STORAGE_KEY_RIGHT_PANEL_BASE = 'sic_workspace_right_panel_open';

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Access current profile from Auth; user is always set after the async boot.
  const { user } = useAuth();
  const currentProfileId = user?.id ?? '';

  const lastProfileIdRef = useRef<string>(currentProfileId);

  const makeKey = (base: string, profileId: string) => `${base}_${profileId}`;

  // Load initial state from local storage (scoped to profile) or set defaults
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const pid = currentProfileId;
    try {
      const stored = localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_TABS_BASE, pid));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to parse stored tabs', e);
    }
    // Default starting tab
    return [{ id: 'today', type: 'today', title: 'Today' }];
  });

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const pid = currentProfileId;
    const stored = localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_ACTIVE_TAB_BASE, pid));
    if (stored) return stored;
    return 'today';
  });

  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    const pid = currentProfileId;
    return localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_SIDEBAR_BASE, pid)) === 'true';
  });

  const [rightPanelOpen, setRightPanelOpenState] = useState<boolean>(() => {
    const pid = currentProfileId;
    const stored = localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_RIGHT_PANEL_BASE, pid));
    return stored === 'false' ? false : true; // Default to true if not set
  });

  // Save to localStorage whenever tabs or activeTabId changes.
  // Deferred via requestIdleCallback so these writes don't block the first paint.
  // They're guaranteed to complete within 1s even if the browser stays busy.
  useEffect(() => {
    const pid = lastProfileIdRef.current || currentProfileId;
    const snapshot = JSON.stringify(tabs);
    const key = makeKey(LOCAL_STORAGE_KEY_TABS_BASE, pid);
    requestIdleCallback
      ? requestIdleCallback(() => { try { localStorage.setItem(key, snapshot); } catch {} }, { timeout: 1000 })
      : setTimeout(() => { try { localStorage.setItem(key, snapshot); } catch {} }, 0);
  }, [tabs]);

  useEffect(() => {
    const pid = lastProfileIdRef.current || currentProfileId;
    const key = makeKey(LOCAL_STORAGE_KEY_ACTIVE_TAB_BASE, pid);
    const value = activeTabId;
    requestIdleCallback
      ? requestIdleCallback(() => {
          if (value) localStorage.setItem(key, value);
          else localStorage.removeItem(key);
        }, { timeout: 1000 })
      : setTimeout(() => {
          if (value) localStorage.setItem(key, value);
          else localStorage.removeItem(key);
        }, 0);
  }, [activeTabId]);

  const setSidebarCollapsed = useCallback((val: boolean) => {
    setSidebarCollapsedState(val);
    // Defer the write off the critical interaction path
    const pid = lastProfileIdRef.current || currentProfileId;
    const key = makeKey(LOCAL_STORAGE_KEY_SIDEBAR_BASE, pid);
    requestIdleCallback
      ? requestIdleCallback(() => localStorage.setItem(key, String(val)), { timeout: 1000 })
      : setTimeout(() => localStorage.setItem(key, String(val)), 0);
  }, [currentProfileId]);

  const setRightPanelOpen = useCallback((val: boolean) => {
    setRightPanelOpenState(val);
    const pid = lastProfileIdRef.current || currentProfileId;
    const key = makeKey(LOCAL_STORAGE_KEY_RIGHT_PANEL_BASE, pid);
    requestIdleCallback
      ? requestIdleCallback(() => localStorage.setItem(key, String(val)), { timeout: 1000 })
      : setTimeout(() => localStorage.setItem(key, String(val)), 0);
  }, [currentProfileId]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState(prev => {
      const next = !prev;
      const pid = lastProfileIdRef.current || currentProfileId;
      const key = makeKey(LOCAL_STORAGE_KEY_SIDEBAR_BASE, pid);
      // State update is synchronous; defer the localStorage write to stay off the INP path
      requestIdleCallback
        ? requestIdleCallback(() => localStorage.setItem(key, String(next)), { timeout: 1000 })
        : setTimeout(() => localStorage.setItem(key, String(next)), 0);
      return next;
    });
  }, [currentProfileId]);

  const toggleRightPanel = useCallback(() => {
    setRightPanelOpenState(prev => {
      const next = !prev;
      const pid = lastProfileIdRef.current || currentProfileId;
      const key = makeKey(LOCAL_STORAGE_KEY_RIGHT_PANEL_BASE, pid);
      requestIdleCallback
        ? requestIdleCallback(() => localStorage.setItem(key, String(next)), { timeout: 1000 })
        : setTimeout(() => localStorage.setItem(key, String(next)), 0);
      return next;
    });
  }, [currentProfileId]);

  // When the profile changes, load the saved UI state for that profile
  useEffect(() => {
    const pid = currentProfileId;
    try {
      const storedTabs = localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_TABS_BASE, pid));
      if (storedTabs) {
        const parsed = JSON.parse(storedTabs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTabs(parsed);
        } else {
          setTabs([{ id: 'today', type: 'today', title: 'Today' }]);
        }
      } else {
        setTabs([{ id: 'today', type: 'today', title: 'Today' }]);
      }

      const storedActive = localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_ACTIVE_TAB_BASE, pid));
      setActiveTabId(storedActive || 'today');

      setSidebarCollapsedState(localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_SIDEBAR_BASE, pid)) === 'true');

      const rp = localStorage.getItem(makeKey(LOCAL_STORAGE_KEY_RIGHT_PANEL_BASE, pid));
      setRightPanelOpenState(rp === 'false' ? false : true);
    } catch (e) {
      console.error('Failed to load tab state for profile', pid, e);
    } finally {
      // mark lastProfileIdRef so subsequent saves go to this profile
      lastProfileIdRef.current = pid;
    }
  }, [currentProfileId]);

  const activateTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const openTab = useCallback((type: TabType, title?: string, data?: any) => {
    // 1. Handle singleton tabs (Today, Vault, Settings, browser, etc.)
    if (['today', 'vault', 'clip', 'browser', 'settings', 'customize'].includes(type)) {
      setTabs(prev => {
        const existingIndex = prev.findIndex(t => t.type === type);
        if (existingIndex !== -1) {
          // Tab already exists, we will just activate it
          setTimeout(() => setActiveTabId(prev[existingIndex].id), 0);
          return prev;
        }
        // Create new tab with static ID for singletons
        const newTab: Tab = {
          id: type,
          type,
          title: title || type.charAt(0).toUpperCase() + type.slice(1)
        };
        setTimeout(() => setActiveTabId(newTab.id), 0);
        return [...prev, newTab];
      });
      return;
    }

    // 2. Handle dynamic dynamic tabs (document, note)
    if (['document', 'note'].includes(type)) {
      const targetId = data?.id ? `${type}-${data.id}` : `${type}-${Date.now()}`;
      setTabs(prev => {
        const existingIndex = prev.findIndex(t => t.type === type && t.data?.id === data?.id);
        if (existingIndex !== -1) {
          // Already open, activate it
          setTimeout(() => setActiveTabId(prev[existingIndex].id), 0);
          return prev;
        }
        // Otherwise, create a new dynamic tab
        const newTab: Tab = {
          id: targetId,
          type,
          title: title || (type === 'note' ? 'Note' : 'Document'),
          data
        };
        setTimeout(() => setActiveTabId(newTab.id), 0);
        return [...prev, newTab];
      });
    }
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const nextTabs = prev.filter(t => t.id !== id);
      
      // If we closed the active tab, find a new active tab
      if (activeTabId === id) {
        if (nextTabs.length > 0) {
          // Try to activate the tab that was next to the closed tab, or the last tab
          const closedIndex = prev.findIndex(t => t.id === id);
          const nextActiveIndex = Math.min(closedIndex, nextTabs.length - 1);
          setTimeout(() => setActiveTabId(nextTabs[nextActiveIndex].id), 0);
        } else {
          // No tabs left! Open default Today tab
          const defaultTab: Tab = { id: 'today', type: 'today', title: 'Today' };
          setTimeout(() => setActiveTabId(defaultTab.id), 0);
          return [defaultTab];
        }
      }
      return nextTabs;
    });
  }, [activeTabId]);

  return (
    <TabContext.Provider
      value={{
        tabs,
        activeTabId,
        sidebarCollapsed,
        rightPanelOpen,
        openTab,
        closeTab,
        activateTab,
        setTabs,
        toggleSidebar,
        toggleRightPanel,
        setSidebarCollapsed,
        setRightPanelOpen
      }}
    >
      {children}
    </TabContext.Provider>
  );
};

export const useTabs = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider');
  }
  return context;
};
