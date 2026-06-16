import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Bell, HelpCircle, CheckCircle, Info, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { ephemeral } from '../lib/ephemeral';
import ProfileAvatar from './ProfileAvatar';
import { ipcService } from '../services/ipcService';
import type { Material, Screen } from '../types';

interface TopBarProps {
  title: string;
  onNavigateScreen?: (screen: Screen) => void;
}

export default function TopBar({ title, onNavigateScreen }: TopBarProps) {
  const { user } = useAuth();
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

  const getInitials = (name: string) => {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
  };

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
    window.dispatchEvent(
      new CustomEvent('corvovault:library-navigate', {
        detail: { topicId: m.topicId || null, folderId: m.folderId || null },
      })
    );
    onNavigateScreen?.('library');
    setShowVaultHits(false);
    setVaultSearch('');
    setVaultHits([]);
  };

  return (
    <header className="w-full h-16 sticky top-0 z-40 bg-surface/80 backdrop-blur-xl flex items-center justify-between px-8 ml-64 max-w-[calc(100%-16rem)] border-b border-outline-variant/10">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-black text-primary font-headline tracking-tight">{title}</h2>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></div>
          <span className="text-[9px] font-bold text-accent uppercase tracking-tighter">Workbench Active</span>
        </div>
      </div>
      
      <div className="flex-1 max-w-md mx-8">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4" />
          <input
            className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
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
          {showVaultHits && (vaultSearchLoading || vaultHits.length > 0) && (
            <div className="absolute left-0 right-0 top-full mt-2 max-h-72 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl z-50 text-left">
              {vaultSearchLoading ? (
                <div className="p-3 text-xs text-outline">Searching…</div>
              ) : (
                vaultHits.slice(0, 20).map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs hover:bg-surface-container-low border-b border-outline-variant/10 last:border-0"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => openHitInLibrary(m)}
                  >
                    <span className="font-bold text-on-surface block truncate">{m.title || 'Untitled'}</span>
                    <span className="text-[10px] text-outline uppercase">{m.boxType}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="text-on-surface-variant hover:text-primary transition-all relative p-1"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <div className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
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
                className="absolute top-full right-0 mt-4 w-80 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-2xl overflow-hidden z-50"
              >
                <div className="p-4 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
                  <h3 className="text-sm font-black uppercase tracking-widest">Notifications</h3>
                  <span 
                    onClick={handleMarkAllRead}
                    className="text-[10px] font-bold text-primary cursor-pointer hover:underline"
                  >
                    Mark all read
                  </span>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-outline-variant/10">
                  {notifications.length > 0 ? notifications.slice(0, 20).map((n) => {
                    const Icon = n.type === 'success' ? CheckCircle : n.type === 'warning' ? AlertCircle : Info;
                    return (
                      <div key={n.id} className={`p-4 flex gap-4 hover:bg-surface-container-low transition-colors cursor-pointer ${!n.read ? 'bg-primary/5' : ''}`}>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          n.type === 'success' ? 'bg-green-100 text-green-600' : 
                          n.type === 'warning' ? 'bg-amber-100 text-amber-600' : 
                          n.type === 'error' ? 'bg-red-100 text-red-600' :
                          'bg-blue-100 text-blue-600'
                        }`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black text-on-surface truncate">{n.title}</p>
                          <p className="text-[10px] text-on-surface-variant leading-relaxed">{n.message}</p>
                          <p className="text-[9px] text-outline mt-1">{new Date(n.time).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="p-8 text-center text-outline text-xs italic">No notifications yet</div>
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
          className="text-on-surface-variant hover:text-primary transition-all p-1"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
        <div className="h-8 w-px bg-outline-variant/30"></div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden md:block">
            <p className="text-[10px] font-black text-on-surface truncate">{user?.name || 'Curator'}</p>
            <p className="text-[8px] font-bold text-primary uppercase tracking-widest">Builder Session</p>
          </div>
          <ProfileAvatar photoURL={user?.photoURL} name={user?.name} size="md" />
        </div>
      </div>
    </header>
  );
}
