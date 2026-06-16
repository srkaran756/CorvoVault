import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, LayoutDashboard, Library, PlusCircle, Globe, Settings, Palette, FileText, StickyNote, Sun, Moon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../hooks/useTabs';
import { motion, AnimatePresence } from 'motion/react';
import { ipcService } from '../../services/ipcService';
import type { Material } from '../../types';
import { applyThemeToDom, DEFAULT_THEME, isDarkColor } from '../../lib/theme';

const iconMap: any = {
  today: LayoutDashboard,
  vault: Library,
  clip: PlusCircle,
  browser: Globe,
  settings: Settings,
  customize: Palette,
  document: FileText,
  note: StickyNote
};

export default function TitleBar() {
  const { user } = useAuth();
  const { tabs, activeTabId, activateTab, closeTab, openTab } = useTabs();
  
  // Window maximized state
  const [isMaximized, setIsMaximized] = useState(false);
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);

  // Tab scroll states & refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showNav, setShowNav] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollIntervalRef = useRef<number | null>(null);

  // Pointer drag states
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);

  // Theme tracking & toggle
  const [currentTheme, setCurrentTheme] = useState<Record<string, string>>(DEFAULT_THEME);

  useEffect(() => {
    if (!user?.id) return;
    
    // Fetch initial saved theme
    ipcService.theme.get(user.id).then(saved => {
      if (saved && Object.keys(saved).length > 0) {
        setCurrentTheme({ ...DEFAULT_THEME, ...saved });
      }
    });

    const handleThemeUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<Record<string, string>>;
      if (customEvent.detail) {
        setCurrentTheme(customEvent.detail);
      }
    };
    window.addEventListener('corvovault:theme-updated', handleThemeUpdated);
    return () => {
      window.removeEventListener('corvovault:theme-updated', handleThemeUpdated);
    };
  }, [user?.id]);

  const isDark = isDarkColor(currentTheme['--bg'] || '#f8fafc');

  const handleThemeToggle = () => {
    if (!user?.id) return;
    const currentIsDark = isDarkColor(currentTheme['--bg'] || '#f8fafc');
    
    const targetColors = currentIsDark 
      ? {
          '--bg': '#ffffff',
          '--bg-elev': '#f5f5f5',
          '--card': '#ffffff',
          '--primary': '#7a55a5',
          '--primary-contrast': '#ffffff',
          '--text': '#242424',
          '--muted': '#707070',
          '--accent': '#7a55a5',
          '--border': '#e0e0e0',
        }
      : {
          '--bg': '#1e1e1e',
          '--bg-elev': '#161616',
          '--card': '#242424',
          '--primary': '#7a55a5',
          '--primary-contrast': '#ffffff',
          '--text': '#e3e3e3',
          '--muted': '#999999',
          '--accent': '#7a55a5',
          '--border': '#2e2e2e',
        };

    const nextTheme = { ...currentTheme, ...targetColors };
    setCurrentTheme(nextTheme);
    applyThemeToDom(nextTheme);
    ipcService.theme.save(user.id, nextTheme);
    window.dispatchEvent(new CustomEvent('corvovault:theme-updated', { detail: nextTheme }));
  };

  // Scroll active tab into view if overflowed
  useEffect(() => {
    if (activeTabId && scrollContainerRef.current) {
      const activeEl = scrollContainerRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeTabId]);

  // Determine if overflow exists and whether we can scroll left/right
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const update = () => {
      setShowNav(el.scrollWidth > el.clientWidth + 4);
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    update();
    el.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tabs.length]);

  const stopContinuousScroll = () => {
    if (scrollIntervalRef.current) {
      window.clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  const handleTabClick = (tabId: string) => {
    if (scrollContainerRef.current?.dataset.dragging === 'true') return;
    activateTab(tabId);
  };

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  // Pointer-based drag to scroll
  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    stopContinuousScroll();
    isDraggingRef.current = false;
    dragStartXRef.current = e.clientX;
    dragStartScrollRef.current = el.scrollLeft;
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollContainerRef.current;
    if (!el || e.buttons === 0) return;
    const dx = e.clientX - dragStartXRef.current;
    if (Math.abs(dx) > 4) isDraggingRef.current = true;
    el.scrollLeft = dragStartScrollRef.current - dx * 0.85;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
    if (isDraggingRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.dataset.dragging = 'true';
      window.setTimeout(() => {
        if (scrollContainerRef.current) scrollContainerRef.current.dataset.dragging = 'false';
      }, 50);
    }
    isDraggingRef.current = false;
  };

  // Convert vertical wheel to horizontal scroll when hovering the tab bar
  const onWheel = (e: React.WheelEvent) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    el.scrollBy({ left: delta * 0.6, behavior: 'auto' });
    e.preventDefault();
  };

  // Vault Search States
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
    openTab('vault', 'Vault');
    window.dispatchEvent(
      new CustomEvent('corvovault:library-navigate', {
        detail: { topicId: m.topicId || null, folderId: m.folderId || null },
      })
    );
    setShowVaultHits(false);
    setVaultSearch('');
    setVaultHits([]);
  };

  // Electron window maximized sync
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    const checkMaximized = async () => {
      try {
        const state = await window.electronAPI!.invoke('window:isMaximized');
        setIsMaximized(Boolean(state));
      } catch (err) {
        console.warn('Failed to query window maximization state:', err);
      }
    };

    checkMaximized();
    window.addEventListener('resize', checkMaximized);
    return () => {
      window.removeEventListener('resize', checkMaximized);
    };
  }, [isElectron]);

  const handleMinimize = () => {
    window.electronAPI?.invoke('window:minimize');
  };

  const handleMaximize = () => {
    window.electronAPI?.invoke('window:maximize');
  };

  const handleClose = () => {
    window.electronAPI?.invoke('window:close');
  };

  return (
    <header className="w-full h-11 shrink-0 bg-surface/90 border-b border-outline-variant/10 backdrop-blur-xl flex items-center justify-between px-4 z-40 transition-all select-none duration-200 drag-handle relative">
      {/* Left: Logo (drag-handle) */}
      <div className="flex items-center gap-2 pr-3 shrink-0 select-none drag-handle">
        <div className="flex items-center gap-2">
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
          <span className="text-xs font-black tracking-tight text-on-surface font-headline leading-none hidden md:block">
            CorvoVault
          </span>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 scale-[0.75] transform origin-left">
            <div className="w-1 h-1 rounded-full bg-accent animate-pulse"></div>
          </div>
        </div>
      </div>

      {/* Center: Workspace Tab ribbon (no-drag) */}
      <div
        ref={scrollContainerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        className="flex-1 h-full flex items-end overflow-x-auto overflow-y-hidden no-scrollbar gap-0.5 px-2 select-none no-drag"
      >
        {tabs.map((tab: any, index: number) => {
          const Icon = iconMap[tab.type] || FileText;
          const isActive = activeTabId === tab.id;
          const isNextActive = tabs[index + 1]?.id === activeTabId;

          return (
            <React.Fragment key={tab.id}>
              <button
                data-tab-id={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`h-8 px-3 flex items-center gap-1.5 text-[11px] font-bold transition-all relative workspace-tab-item duration-200 outline-none shrink-0 group ${
                  isActive
                    ? `${isDark ? 'bg-surface-container after:bg-surface-container' : 'bg-white after:bg-white'} border-t border-l border-r border-outline-variant/15 rounded-t-[6px] text-accent z-10 after:content-[""] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-[1.5px] after:z-20 shadow-sm`
                    : 'bg-transparent border-transparent text-outline hover:text-on-surface hover:bg-surface-container-lowest/40 rounded-t-[4px]'
                }`}
              >
                <Icon className={`w-3 h-3 transition-transform duration-200 group-hover:scale-105 ${isActive ? 'text-accent' : 'text-outline/70 group-hover:text-on-surface'}`} />
                {(tab.type === 'document' || tab.type === 'note') && (
                  <span className="w-1 h-1 rounded-full bg-accent shrink-0" />
                )}
                <span className="truncate max-w-[100px]">{tab.title}</span>

                <span
                  onClick={(e) => handleCloseClick(e, tab.id)}
                  className="p-0.5 rounded-full hover:bg-outline-variant/25 hover:text-red-500 text-outline/50 transition-colors shrink-0 outline-none opacity-40 group-hover:opacity-100"
                  title="Close Tab"
                >
                  <X className="w-2 h-2" />
                </span>
              </button>

              {!isActive && !isNextActive && index < tabs.length - 1 && (
                <div className="h-3 w-[1px] bg-outline-variant/10 self-center mx-[1.5px] shrink-0" />
              )}
            </React.Fragment>
          );
        })}

        {/* New Tab "+" button */}
        <button
          onClick={() => openTab('today', 'Today')}
          className="h-8 w-8 flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container-lowest/40 rounded-lg mb-0.5 shrink-0 transition-colors relative group outline-none cursor-pointer"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          
          {/* Obsidian-Style centered upward pointing tooltip */}
          <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-[#2a2a2a] text-white text-[10px] rounded-lg font-bold whitespace-nowrap opacity-0 -translate-y-2 scale-95 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-200 ease-out delay-150 z-50 shadow-2xl before:content-[''] before:absolute before:-top-3 before:left-1/2 before:-translate-x-1/2 before:border-[6px] before:border-transparent before:border-b-[#2a2a2a]">
            New tab
          </div>
        </button>
      </div>

      {/* Right: Compact search & window controls */}
      <div className="flex items-center gap-2 shrink-0 no-drag pl-3 h-full">
        {/* Obsidian-Style Theme Mode Toggle */}
        <button
          onClick={handleThemeToggle}
          className="h-8 w-8 flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container-lowest/40 rounded-lg shrink-0 transition-all duration-200 outline-none cursor-pointer relative group"
          title={isDark ? 'Switch to Day Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme mode"
        >
          {isDark ? (
            <Sun className="w-3.5 h-3.5 transition-transform duration-200 group-hover:rotate-45" />
          ) : (
            <Moon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:-rotate-12" />
          )}
        </button>

        {/* Compact Expanding Search Bar */}
        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline w-3 h-3 group-focus-within:text-primary transition-colors" />
          <input
            className="bg-surface-container-low border border-outline-variant/10 rounded-full py-1 pl-7 pr-3 text-[10px] focus:ring-1.5 focus:ring-primary/20 focus:outline-none transition-all placeholder:text-outline/70 focus:bg-surface-container-lowest text-on-surface w-24 focus:w-44 duration-300"
            placeholder="Search..."
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
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-2 w-64 max-h-60 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl z-50 text-left no-scrollbar"
              >
                {vaultSearchLoading ? (
                  <div className="p-3 text-[10px] text-outline italic">Searching...</div>
                ) : (
                  vaultHits.slice(0, 15).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-surface-container-low border-b border-outline-variant/5 last:border-0 transition-colors"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => openHitInLibrary(m)}
                    >
                      <span className="font-bold text-on-surface block truncate">{m.title || 'Untitled'}</span>
                      <span className="text-[8px] text-outline uppercase tracking-wider font-semibold">{m.boxType}</span>
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Electron Window Controls */}
        {isElectron && (
          <div className="flex items-center border-l border-outline-variant/10 pl-1.5 h-full -mr-4">
            {/* Minimize */}
            <button
              onClick={handleMinimize}
              className="w-9 h-11 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all duration-200 active:scale-[0.85] focus:outline-none cursor-pointer"
              title="Minimize"
              aria-label="Minimize Window"
            >
              <svg width="8" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>

            {/* Maximize */}
            <button
              onClick={handleMaximize}
              className="w-9 h-11 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all duration-200 active:scale-[0.85] focus:outline-none cursor-pointer"
              title={isMaximized ? 'Restore' : 'Maximize'}
              aria-label={isMaximized ? 'Restore Window' : 'Maximize Window'}
            >
              {isMaximized ? (
                <svg width="8" height="8" viewBox="0 0 10 10">
                  <path
                    d="M2,2 L2,0 L10,0 L10,8 L8,8 L8,10 L0,10 L0,2 Z M3,2 L8,2 L8,7 L9,7 L9,1 L3,1 Z M1,3 L7,3 L7,9 L1,9 Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg width="8" height="8" viewBox="0 0 10 10">
                  <path
                    d="M1,1 L9,1 L9,9 L1,9 Z M0,0 L0,10 L10,10 L10,0 Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </button>

            {/* Close */}
            <button
              onClick={handleClose}
              className="w-9 h-11 flex items-center justify-center text-on-surface-variant hover:bg-[#e81123] hover:text-white transition-all duration-200 active:scale-[0.85] focus:outline-none cursor-pointer rounded-tr-lg"
              title="Close"
              aria-label="Close Window"
            >
              <svg width="8" height="8" viewBox="0 0 10 10">
                <path
                  d="M0,0 L10,10 M10,0 L0,10"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
