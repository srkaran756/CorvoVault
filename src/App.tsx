import { useState, useEffect } from 'react';
import DesignPlayground from './components/DesignPlayground';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { MigrationGate } from './components/MigrationGate';
import { TabProvider } from './contexts/TabContext';
import AppShell from './components/layout/AppShell';
import { ipcService } from './services/ipcService';
import { applyThemeToDom, DEFAULT_THEME } from './lib/theme';
import { AnimatePresence } from 'motion/react';
import DownloadPromptModal from './components/layout/DownloadPromptModal';
import DevDownloadInspector from './components/layout/DevDownloadInspector';
import { useTabs } from './hooks/useTabs';



interface PendingDownload {
  downloadId: string;
  filename: string;
  totalBytes: number;
}

function AppContent() {
  const { user, loading } = useAuth();
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinEntry, setPinEntry] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinConfig, setPinConfig] = useState<{ enabled: boolean } | null>(null);
  const [pinConfigLoading, setPinConfigLoading] = useState(true);
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);

  // Load pin config async (from userData/pin_config.json via IPC), replacing the old
  // synchronous localStorage.getItem('sic_launch_pin_config') read.
  useEffect(() => {
    if (!window.electronAPI) {
      setPinConfigLoading(false);
      return;
    }
    ipcService.pin.get().then(config => {
      setPinConfig(config);
    }).catch(() => {
      setPinConfig(null);
    }).finally(() => {
      setPinConfigLoading(false);
    });
  }, []);

  // Load and apply the profile theme from SQLite on profile change, and sync updates
  useEffect(() => {
    if (!user?.id) return;

    const handleThemeUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<Record<string, string>>;
      if (customEvent.detail) {
        applyThemeToDom(customEvent.detail);
      }
    };
    window.addEventListener('corvovault:theme-updated', handleThemeUpdated);

    return () => {
      window.removeEventListener('corvovault:theme-updated', handleThemeUpdated);
    };
  }, [user?.id]);

  // Listen for background download options prompt requests
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = window.electronAPI.on('download:request-options', (data: PendingDownload) => {
      setPendingDownload(data);
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);



  const handlePinUnlock = async () => {
    if (!pinConfig) return;
    setPinError(false);
    try {
      const success = await ipcService.pin.verify(pinEntry);
      if (success) {
        setPinUnlocked(true);
      } else {
        setPinError(true);
        setPinEntry('');
      }
    } catch {
      setPinError(true);
    }
  };

  const isPinLocked = pinConfig?.enabled && !pinUnlocked;

  // Show spinner while auth or pin config is loading
  if (loading || pinConfigLoading) {
    return (
      <div className="min-h-screen bg-surface/50 flex flex-col items-center justify-center gap-6 backdrop-blur-sm">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-bold text-outline uppercase tracking-widest">Initializing Sanctuary...</p>
        </div>
      </div>
    );
  }

  if (isPinLocked) {
    return (
      <div className="min-h-screen bg-surface/30 flex flex-col items-center justify-center gap-8 font-body backdrop-blur-sm">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center relative shadow-inner">
          <img
            src="logo_full.png"
            alt="CorvoVault Logo"
            className="w-14 h-14 object-contain rounded-full drop-shadow-md"
          />
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-surface border border-outline-variant/10 flex items-center justify-center shadow-lg text-primary">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold font-headline tracking-tight text-on-surface">Sanctuary Locked</h1>
          <p className="text-sm text-on-surface-variant">Enter your PIN to resume your session.</p>
        </div>
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
          <input
            type="password"
            autoFocus
            maxLength={12}
            value={pinEntry}
            onChange={e => setPinEntry(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePinUnlock()}
            className={`w-full bg-surface-container-low border-2 text-center text-xl tracking-widest rounded-2xl p-4 focus:outline-none transition-colors ${pinError ? 'border-red-500 text-red-500' : 'border-transparent focus:border-primary text-on-surface'}`}
            placeholder="••••"
          />
          {pinError ? (
            <p className="text-xs font-bold text-red-500 animate-pulse">Incorrect PIN</p>
          ) : (
            <p className="text-xs text-outline h-4">{/* Spacer */}</p>
          )}
          <button
            onClick={handlePinUnlock}
            className="w-full mt-2 bg-primary text-on-primary font-bold py-4 rounded-xl shadow-lg hover:scale-[1.02] active:scale-95 transition-all"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <DesignPlayground>
      <TabProvider>
        <AppShell />
        <DownloadPromptGate
          pendingDownload={pendingDownload}
          setPendingDownload={setPendingDownload}
          user={user}
        />
        <DevDownloadInspector />
      </TabProvider>
    </DesignPlayground>
  );
}

function DownloadPromptGate({
  pendingDownload,
  setPendingDownload,
  user
}: {
  pendingDownload: PendingDownload | null;
  setPendingDownload: (d: PendingDownload | null) => void;
  user: any;
}) {
  const { tabs, activeTabId } = useTabs();
  const activeTab = tabs?.find(t => t.id === activeTabId);
  const activeCourse = activeTab?.type === 'course-workspace' ? activeTab.data : null;

  return (
    <AnimatePresence>
      {pendingDownload && (
        <DownloadPromptModal
          filename={pendingDownload.filename}
          totalBytes={pendingDownload.totalBytes}
          profileId={user?.id || ''}
          activeCourse={activeCourse}
          onResolve={async (choice, destination) => {
            if (window.electronAPI) {
              await window.electronAPI.invoke('download:resolve-options', {
                downloadId: pendingDownload.downloadId,
                choice,
                destination
              });
              if (choice === 'vault') {
                // Navigate to Vault view
                window.dispatchEvent(new CustomEvent('corvovault:switch-tab', { detail: { tab: 'vault' } }));
              }
            }
            setPendingDownload(null);
          }}
        />
      )}
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <MigrationGate>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </MigrationGate>
  );
}
