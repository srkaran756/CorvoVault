import React, { useEffect, Suspense, lazy, useRef, useCallback } from 'react';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import RightPanel from './RightPanel';
import StatusBar from './StatusBar';
import { useTabs } from '../../hooks/useTabs';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { Tab } from '../../contexts/TabContext';

// Always-ready tabs (opened on startup)
import TodayView from '../tabs/TodayView';

// Lazy-loaded tabs — parsed only when the user first opens them
// VaultView is the biggest (81KB Library.tsx) — lazy-loading it fixes LCP
const VaultView      = lazy(() => import('../tabs/VaultView'));
const ClipView       = lazy(() => import('../tabs/ClipView'));
const BrowserView    = lazy(() => import('../tabs/BrowserView'));
const SettingsView   = lazy(() => import('../tabs/SettingsView'));
const CustomizeView  = lazy(() => import('../tabs/CustomizeView'));
const DocumentViewer = lazy(() => import('../tabs/DocumentViewer'));
const NoteEditor     = lazy(() => import('../tabs/NoteEditor'));

/** Minimal fallback shown while a lazy tab chunk loads (first open only) */
function TabSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function AppShell() {
  const { tabs, activeTabId, openTab } = useTabs();

  // Track which tab IDs have been mounted at least once.
  // Tabs that have never been active are not rendered at all —
  // avoiding any parse/render cost until the user actually opens them.
  const mountedTabsRef = useRef<Set<string>>(new Set());

  // Register keyboard shortcuts globally inside workspace shell
  useKeyboardShortcuts();

  // Resolve deep-linking route on mount
  // Production Electron loads file://.../dist/index.html where the pathname may not match
  // our app routes (e.g. could be "/" instead of "/vault"). Support path/hash/query.
  useEffect(() => {
    const tabMap: Record<string, () => void> = {
      '/vault': () => openTab('vault', 'Vault'),
      '/clip': () => openTab('clip', 'Clip'),
      '/browser': () => openTab('browser', 'Browser'),
      '/settings': () => openTab('settings', 'Settings'),
    };

    const pickFromPath = () => {
      const pathname = window.location.pathname || '';
      // normalize: strip trailing slashes
      const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
      return tabMap[normalized] ?? tabMap[`/${normalized.replace(/^\//, '')}`] ?? null;
    };

    const pickFromHash = () => {
      // Support: #/vault or #vault
      const raw = window.location.hash || '';
      if (!raw) return null;
      const hash = raw.startsWith('#/') ? raw.slice(2) : raw.slice(1);
      const withSlash = hash.startsWith('/') ? hash : `/${hash}`;
      return tabMap[withSlash] ?? null;
    };

    const pickFromQuery = () => {
      // Support: ?tab=vault (or ?tab=browser etc.)
      const searchParams = new URLSearchParams(window.location.search || '');
      const tab = searchParams.get('tab');
      if (!tab) return null;

      switch (tab) {
        case 'vault': return () => openTab('vault', 'Vault');
        case 'clip': return () => openTab('clip', 'Clip');
        case 'browser': return () => openTab('browser', 'Browser');
        case 'settings': return () => openTab('settings', 'Settings');
        default: return null;
      }
    };

    const opener =
      pickFromHash() ??
      pickFromQuery() ??
      pickFromPath();

    if (opener) opener();
  }, [openTab]);

  const renderTabContent = useCallback((tab: Tab) => {
    switch (tab.type) {
      case 'today':    return <TodayView />;
      case 'vault':    return <VaultView isActive={true} />;
      case 'clip':     return <ClipView />;
      case 'browser':  return <BrowserView isActive={true} />;
      case 'settings': return <SettingsView />;
      case 'customize':return <CustomizeView />;
      case 'document': return <DocumentViewer data={tab.data} isActive={true} />;
      case 'note':     return <NoteEditor data={tab.data} isActive={true} />;
      default:         return <TodayView />;
    }
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface text-on-surface font-body">
      {/* Custom title bar for Electron */}
      <TitleBar />

      <div className="flex flex-1 overflow-hidden min-h-0 w-full">
        {/* slim Collapsible Navigation Launcher */}
        <Sidebar />

        {/* Center Workspace & Right contextual sidebar */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
          {/* Active View + Collapsible Context Panel */}
          <div className="flex flex-1 min-h-0 overflow-hidden relative">
            <main className="flex-1 min-w-0 h-full overflow-hidden bg-surface relative">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                // Mark this tab as mounted on first activation
                if (isActive) mountedTabsRef.current.add(tab.id);
                // Never render tabs the user hasn't opened yet—avoids all parse/render cost
                if (!mountedTabsRef.current.has(tab.id)) return null;

                return (
                  <div
                    key={tab.id}
                    // Pure CSS visibility — no JS animation engine running on tab switch.
                    // The tab-panel-active/inactive classes use CSS opacity + pointer-events.
                    className={`w-full h-full absolute inset-0 ${
                      isActive ? 'tab-panel-active' : 'tab-panel-inactive'
                    }`}
                  >
                    <Suspense fallback={<TabSkeleton />}>
                      {renderTabContent(tab)}
                    </Suspense>
                  </div>
                );
              })}
            </main>

            {/* Context-aware Inspector Panel */}
            <RightPanel />
          </div>

          {/* Micro Status bar */}
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
