import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Bell, HelpCircle, CheckCircle, Info, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../hooks/useTabs';
import { motion, AnimatePresence } from 'motion/react';
import { ephemeral } from '../../lib/ephemeral';
import ProfileAvatar from '../ProfileAvatar';
import { ipcService } from '../../services/ipcService';
import type { Material } from '../../types';

export default function Header() {
  const { user } = useAuth();
  const { openTab } = useTabs();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState(user ? ephemeral.getNotifications(user.id) : []);

  useEffect(() => {
    if (user) {
      setNotifications(ephemeral.getNotifications(user.id));
    }
  }, [user]);

  // Refresh notifications periodically
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      setNotifications(ephemeral.getNotifications(user.id));
    }, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const handleMarkAllRead = () => {
    if (!user) return;
    const updated = notifications.map(n => ({ ...n, read: true }));
    setNotifications(updated);
    ephemeral.saveNotifications(user.id, updated);
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const [vaultSearch, setVaultSearch] = useState('');
  const [vaultHits, setVaultHits] = useState<Material[]>([]);
  const [vaultSearchLoading, setVaultSearchLoading] = useState(false);
  const [showVaultHits, setShowVaultHits] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runVaultSearch = useCallback(
    async (q: string) => {
      if (!user?.id || !q.trim()) {
        setVaultHits([]);
        return;
      }
      setVaultSearchLoading(true);
      try {
        const hits = await ipcService.vault.searchMaterials(user.id, q.trim());
        setVaultHits(hits);
      } finally {
        setVaultSearchLoading(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!vaultSearch.trim()) {
      setVaultHits([]);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      runVaultSearch(vaultSearch);
    }, 320);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [vaultSearch, runVaultSearch]);

  const openHitInLibrary = (m: Material) => {
    // Open vault tab
    openTab('vault', 'Vault');
    // Dispatch library navigation event
    window.dispatchEvent(
      new CustomEvent('corvovault:library-navigate', {
        detail: { topicId: m.topicId || null, folderId: m.folderId || null },
      })
    );
    setShowVaultHits(false);
    setVaultSearch('');
    setVaultHits([]);
  };

  return (
    <header className="w-full h-12 shrink-0 bg-surface/90 border-b border-outline-variant/10 backdrop-blur-xl flex items-center justify-between px-6 z-40 transition-all select-none duration-200">
      {/* Left: Logo & State dots */}
      <div className="flex items-center gap-3 w-48 shrink-0">
        <div
          style={{
            maskImage: "url('icon.png')",
            WebkitMaskImage: "url('icon.png')",
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
            backgroundColor: 'currentColor'
          }}
          className="w-4 h-4 shrink-0 text-primary"
        />
        <span className="text-sm font-black tracking-tight text-on-surface font-headline leading-none">
          CorvoVault
        </span>
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 scale-[0.85] transform origin-left">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></div>
        </div>
      </div>

      {/* Center: Obsidian-Style search bar */}
      <div className="flex-1 max-w-lg mx-6 relative">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-3.5 h-3.5 group-focus-within:text-primary transition-colors" />
          <input
            className="w-full bg-surface-container-low border border-outline-variant/10 rounded-full py-1 pl-9 pr-4 text-xs focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-outline/70 focus:bg-surface-container-lowest"
            placeholder="Search the vault..."
            type="text"
            value={vaultSearch}
            onChange={e => {
              setVaultSearch(e.target.value);
              setShowVaultHits(true);
            }}
            onFocus={() => setShowVaultHits(true)}
            onBlur={() => setTimeout(() => setShowVaultHits(false), 200)}
            autoComplete="off"
          />
          <AnimatePresence>
            {showVaultHits && (vaultSearchLoading || vaultHits.length > 0) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 right-0 top-full mt-2 max-h-72 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl z-50 text-left no-scrollbar"
              >
                {vaultSearchLoading ? (
                  <div className="p-3 text-xs text-outline italic">Searching the vault…</div>
                ) : (
                  vaultHits.slice(0, 20).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full text-left px-4 py-2 text-xs hover:bg-surface-container-low border-b border-outline-variant/5 last:border-0 transition-colors"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => openHitInLibrary(m)}
                    >
                      <span className="font-bold text-on-surface block truncate">{m.title || 'Untitled'}</span>
                      <span className="text-[9px] text-outline uppercase tracking-wider font-semibold">{m.boxType}</span>
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right: Notifications, Help, Profile */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="text-on-surface-variant hover:text-primary transition-all relative p-1 rounded-lg hover:bg-surface-container-low"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full text-[7px] text-white flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </div>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-full right-0 mt-3 w-82 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-2xl overflow-hidden z-50"
              >
                <div className="p-3.5 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
                  <h3 className="text-xs font-black uppercase tracking-wider text-on-surface-variant font-headline">Notifications</h3>
                  <span
                    onClick={handleMarkAllRead}
                    className="text-[9px] font-bold text-primary cursor-pointer hover:underline uppercase"
                  >
                    Mark all read
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-outline-variant/10 no-scrollbar">
                  {notifications.length > 0 ? notifications.slice(0, 15).map((n) => {
                    const Icon = n.type === 'success' ? CheckCircle : n.type === 'warning' ? AlertCircle : Info;
                    return (
                      <div key={n.id} className={`p-3.5 flex gap-3 hover:bg-surface-container-low transition-colors cursor-pointer ${!n.read ? 'bg-primary/5' : ''}`}>
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          n.type === 'success' ? 'bg-green-50 text-green-600' :
                          n.type === 'warning' ? 'bg-amber-50 text-amber-600' :
                          n.type === 'error' ? 'bg-red-50 text-red-600' :
                          'bg-blue-50 text-blue-600'
                        }`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-on-surface truncate leading-snug">{n.title}</p>
                          <p className="text-[10px] text-on-surface-variant leading-relaxed truncate">{n.message}</p>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="p-6 text-center text-outline text-xs italic">No new events</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => {
            if (window.electronAPI) {
              window.electronAPI.openExternal('https://github.com');
            } else {
              window.open('https://github.com', '_blank');
            }
          }}
          className="text-on-surface-variant hover:text-primary transition-all p-1 rounded-lg hover:bg-surface-container-low"
          title="Documentation"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-outline-variant/20"></div>

        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-black text-on-surface leading-tight truncate max-w-[80px]">
              {user?.name || 'Curator'}
            </p>
          </div>
          <ProfileAvatar photoURL={user?.photoURL} name={user?.name} size="sm" />
        </div>
      </div>
    </header>
  );
}
