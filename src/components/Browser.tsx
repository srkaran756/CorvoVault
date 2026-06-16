import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Globe, ArrowLeft, ArrowRight, RotateCw, Plus, X, Search, Bookmark, BookmarkCheck, Shield, Loader2, ExternalLink, Trash2, Home, Settings, ZoomIn, ZoomOut, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMaterials, useTopics, useFolders, useBookmarks } from '../hooks/useLocalData';
import { Screen } from '../types';
import { useActivityTimer } from '../hooks/useActivityTimer';


const DEFAULT_HOME = 'https://www.google.com';
const SEARCH_ENGINES: Record<string, string> = {
  Google: 'https://www.google.com/search?q=',
  DuckDuckGo: 'https://duckduckgo.com/?q=',
  Bing: 'https://www.bing.com/search?q=',
};

interface Tab {
  id: string;
  title: string;
  url: string;
  initialUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface BrowserProps {
  initialUrl?: string;
  onNavigate?: (screen: Screen, url?: string) => void;
  isActive?: boolean;
}

const isElectron = !!(window as any).electronAPI?.isElectron;

export default function Browser({ initialUrl, onNavigate, isActive = true }: BrowserProps) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', title: 'New Tab', url: initialUrl || DEFAULT_HOME, initialUrl: initialUrl || DEFAULT_HOME, isLoading: false, canGoBack: false, canGoForward: false },
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [urlInput, setUrlInput] = useState(initialUrl || DEFAULT_HOME);
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [homePage, setHomePage] = useState(() => localStorage.getItem('browser_homepage') || DEFAULT_HOME);
  const [searchEngine, setSearchEngine] = useState(() => localStorage.getItem('browser_search_engine') || 'Google');
  const [searxngInstance, setSearxngInstance] = useState(() => localStorage.getItem('browser_searxng_instance') || '');
  const webviewRefs = useRef<Record<string, any>>({});
  // Track last navigated initialUrl to prevent duplicate tab creation on re-renders
  const lastInitialUrlRef = useRef<string | undefined>(initialUrl);
  // Keep a stable ref to activeTabId so listener callbacks always read the current
  // value without the useCallback needing activeTabId as a dependency (which would
  // recreate the callback — and re-attach listeners — on every tab switch).
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  const { addMaterial } = useMaterials();
  const { topics } = useTopics();
  const { folders } = useFolders();
  const { bookmarks, addBookmark, removeBookmark } = useBookmarks();
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Track real time spent in the built-in browser
  // Browser is only active while this tab is active
  useActivityTimer('Web Browser', isActive);


  const activeTab = tabs.find(t => t.id === activeTabId);

  // Handle initialUrl changes (from Library → Browser navigation)
  // Use a ref to prevent duplicate tabs when parent re-renders with same URL
  useEffect(() => {
    if (initialUrl && initialUrl !== lastInitialUrlRef.current) {
      lastInitialUrlRef.current = initialUrl;

      // Prevent loading unsupported document types in webview
      if (/\.(docx?|odt|rtf|pptx?|xlsx?|zip|rar|tar|gz|exe|msi)$/i.test(initialUrl)) {
        if (window.electronAPI) {
          window.electronAPI.openExternal(initialUrl);
        } else {
          window.open(initialUrl, '_blank');
        }
        return;
      }

      const newTab: Tab = { 
        id: crypto.randomUUID(), 
        title: 'Loading...', 
        url: initialUrl, 
        initialUrl: initialUrl,
        isLoading: true, 
        canGoBack: false, 
        canGoForward: false 
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setUrlInput(initialUrl);
    }
  }, [initialUrl]);

  // Keyboard shortcuts: Ctrl+T (new tab), Ctrl+W (close tab), Ctrl+R (reload)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') { e.preventDefault(); handleAddTab(); }
      if (e.ctrlKey && e.key === 'w') { e.preventDefault(); const t = tabs.find(x => x.id === activeTabId); if (t) handleCloseTab(t.id, e as any); }
      if (e.ctrlKey && e.key === 'r') { e.preventDefault(); reload(); }
      if (e.key === 'F12') { window.electronAPI?.openDevTools?.(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, tabs]);

  // Setup webview event listeners
  const setupWebviewListeners = useCallback((webview: any, tabId: string) => {
    if (!webview) return;

    const onTitleUpdate = (e: any) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title: e.title || t.url } : t));
    };

    const onNavigate = (e: any) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { 
        ...t, 
        url: e.url,
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward(),
      } : t));
      // Use ref so this closure always reads the current active tab,
      // even though setupWebviewListeners is only called once per webview mount.
      if (tabId === activeTabIdRef.current) {
        setUrlInput(e.url);
      }
    };

    const onStartLoading = () => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, isLoading: true } : t));
    };

    const onStopLoading = () => {
      setTabs(prev => prev.map(t => t.id === tabId ? { 
        ...t, 
        isLoading: false,
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward(),
      } : t));
    };

    // Open new-window requests (popups) as new tabs
    const onNewWindow = (e: any) => {
      const popupUrl = e.url || e.detail?.url;
      if (!popupUrl) return;

      // Prevent loading unsupported document types in webview
      if (/\.(docx?|odt|rtf|pptx?|xlsx?|zip|rar|tar|gz|exe|msi)$/i.test(popupUrl)) {
        if (window.electronAPI) {
          window.electronAPI.openExternal(popupUrl);
        } else {
          window.open(popupUrl, '_blank');
        }
        return;
      }

      const newTab: Tab = {
        id: crypto.randomUUID(),
        title: 'Loading...',
        url: popupUrl,
        initialUrl: popupUrl,
        isLoading: true,
        canGoBack: false,
        canGoForward: false,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setUrlInput(popupUrl);
    };

    const onWillNavigate = (e: any) => {
      const url = e.url;
      if (/\.(docx?|odt|rtf|pptx?|xlsx?|zip|rar|tar|gz|exe|msi)$/i.test(url)) {
        e.preventDefault();
        if (window.electronAPI) {
          window.electronAPI.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      }
    };

    webview.addEventListener('page-title-updated', onTitleUpdate);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('new-window', onNewWindow);
    webview.addEventListener('will-navigate', onWillNavigate);

    return () => {
      try {
        webview.removeEventListener('page-title-updated', onTitleUpdate);
        webview.removeEventListener('did-navigate', onNavigate);
        webview.removeEventListener('did-navigate-in-page', onNavigate);
        webview.removeEventListener('did-start-loading', onStartLoading);
        webview.removeEventListener('did-stop-loading', onStopLoading);
        webview.removeEventListener('new-window', onNewWindow);
        webview.removeEventListener('will-navigate', onWillNavigate);
      } catch {}
    };
  // No dependency on activeTabId — the ref keeps it current without re-creating
  // this callback (which would trigger the ref guard and skip re-attaching).
  }, []);

  const handleAddTab = () => {
    const newTab: Tab = { id: crypto.randomUUID(), title: 'New Tab', url: homePage, initialUrl: homePage, isLoading: false, canGoBack: false, canGoForward: false };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
    setUrlInput(newTab.url);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    
    // Smart URL handling
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        // Use configured search engine
        const base = SEARCH_ENGINES[searchEngine] || SEARCH_ENGINES.Google;
        url = `${base}${encodeURIComponent(url)}`;
      }
    }
    
    // Prevent loading unsupported document types in webview
    if (/\.(docx?|odt|rtf|pptx?|xlsx?|zip|rar|tar|gz|exe|msi)$/i.test(url)) {
      if (window.electronAPI) {
        window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
      return;
    }

    setTabs(tabs.map(t => t.id === activeTabId ? { ...t, url, title: 'Loading...' } : t));
    setUrlInput(url);

    // Navigate the webview
    const webview = webviewRefs.current[activeTabId];
    if (webview) {
      webview.loadURL(url);
    }
  };

  const goHome = () => {
    const wv = webviewRefs.current[activeTabId];
    setTabs(tabs.map(t => t.id === activeTabId ? { ...t, url: homePage, title: 'Loading...' } : t));
    setUrlInput(homePage);
    if (wv) wv.loadURL(homePage);
  };

  const zoomIn = () => {
    const wv = webviewRefs.current[activeTabId];
    const next = Math.min(zoomLevel + 0.1, 3.0);
    setZoomLevel(next);
    if (wv?.setZoomFactor) wv.setZoomFactor(next);
  };

  const zoomOut = () => {
    const wv = webviewRefs.current[activeTabId];
    const next = Math.max(zoomLevel - 0.1, 0.3);
    setZoomLevel(next);
    if (wv?.setZoomFactor) wv.setZoomFactor(next);
  };

  const zoomReset = () => {
    const wv = webviewRefs.current[activeTabId];
    setZoomLevel(1.0);
    if (wv?.setZoomFactor) wv.setZoomFactor(1.0);
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = tabs.filter(t => t.id !== id);
    delete webviewRefs.current[id];
    if (newTabs.length === 0) {
      handleAddTab();
    } else {
      setTabs(newTabs);
      if (activeTabId === id) {
        setActiveTabId(newTabs[0].id);
        setUrlInput(newTabs[0].url);
      }
    }
  };

  const goBack = () => {
    const wv = webviewRefs.current[activeTabId];
    if (wv?.canGoBack()) wv.goBack();
  };

  const goForward = () => {
    const wv = webviewRefs.current[activeTabId];
    if (wv?.canGoForward()) wv.goForward();
  };

  const reload = () => {
    const wv = webviewRefs.current[activeTabId];
    if (wv) wv.reload();
  };

  const handleCapture = () => {
    if (!activeTab) return;
    if (topics.length === 0 || folders.length === 0) {
      alert('Please create a topic and folder in the Capture section first.');
      return;
    }
    setShowCaptureDialog(true);
  };

  const doCapture = (topicId: string, folderId: string) => {
    if (!activeTab) return;
    addMaterial({
      title: activeTab.title,
      url: activeTab.url,
      boxType: activeTab.url.includes('youtube.com') || activeTab.url.includes('youtu.be') ? 'youtube' : 'link',
      folderId,
      topicId,
      thumbUrl: activeTab.url.includes('youtube.com') 
        ? `https://img.youtube.com/vi/${activeTab.url.split('v=')[1]?.split('&')[0]}/hqdefault.jpg` 
        : '',
    });
    setShowCaptureDialog(false);
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-surface-container-lowest overflow-hidden">
      {/* Browser Toolbar */}
      <div className="bg-surface-container-low border-b border-outline-variant/10 p-2 flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <button onClick={goBack} disabled={!activeTab?.canGoBack} className="p-2 hover:bg-surface-container-high rounded-lg transition-colors disabled:opacity-30" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button onClick={goForward} disabled={!activeTab?.canGoForward} className="p-2 hover:bg-surface-container-high rounded-lg transition-colors disabled:opacity-30" title="Forward">
            <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={reload} className="p-2 hover:bg-surface-container-high rounded-lg transition-colors" title="Reload (Ctrl+R)">
            {activeTab?.isLoading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <RotateCw className="w-4 h-4" />}
          </button>
          <button onClick={goHome} className="p-2 hover:bg-surface-container-high rounded-lg transition-colors" title="Home">
            <Home className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleUrlSubmit} className="flex-1 relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-outline">
            {activeTab?.url.startsWith('https://') ? <Shield className="w-4 h-4 text-green-600" /> : <Globe className="w-4 h-4" />}
          </div>
          <input 
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-primary transition-all"
            placeholder="Search or enter URL..."
          />
        </form>

        <div className="flex gap-1 items-center">
          {/* Zoom controls */}
          <button onClick={zoomOut} className="p-1.5 hover:bg-surface-container-high text-outline rounded-lg transition-colors" title="Zoom Out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={zoomReset} className="px-2 py-1 hover:bg-surface-container-high text-outline rounded-lg transition-colors text-[10px] font-bold min-w-[42px] text-center" title="Reset Zoom">
            {Math.round(zoomLevel * 100)}%
          </button>
          <button onClick={zoomIn} className="p-1.5 hover:bg-surface-container-high text-outline rounded-lg transition-colors" title="Zoom In">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-outline-variant/20 mx-1" />

          {/* Bookmarks toggle */}
          <button 
            onClick={() => setShowBookmarks(!showBookmarks)}
            className={`p-2 rounded-lg transition-colors flex items-center ${showBookmarks ? 'bg-primary/20 text-primary' : 'hover:bg-surface-container-high text-outline'}`}
            title="Toggle Bookmarks Sidebar"
          >
            <Bookmark className="w-4 h-4" />
          </button>
          {/* Bookmark current page */}
          <button 
            onClick={() => {
              if (activeTab && activeTab.url && activeTab.title) {
                const isBookmarked = bookmarks.some(b => b.url === activeTab.url);
                if (!isBookmarked) {
                  addBookmark(activeTab.title, activeTab.url);
                } else {
                  const b = bookmarks.find(x => x.url === activeTab.url);
                  if (b) removeBookmark(b.id);
                }
              }
            }}
            className="p-2 hover:bg-surface-container-high text-outline rounded-lg transition-colors"
            title="Bookmark Current Tab"
          >
            {activeTab && bookmarks.some(b => b.url === activeTab.url) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
          </button>

          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(s => !s)}
              className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-primary/20 text-primary' : 'hover:bg-surface-container-high text-outline'}`}
              title="Browser Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  className="absolute right-0 top-full mt-2 w-80 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-2xl z-50 p-4 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-widest">Browser Settings</h4>
                    <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-surface-container-high rounded-full"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-outline uppercase tracking-widest block mb-1">Homepage</label>
                      <input
                        type="text"
                        value={homePage}
                        onChange={e => setHomePage(e.target.value)}
                        onBlur={() => localStorage.setItem('browser_homepage', homePage)}
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-xs focus:outline-none focus:border-primary"
                        placeholder="https://www.google.com"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-outline uppercase tracking-widest block mb-1">Default Search Engine</label>
                      <select
                        value={searchEngine}
                        onChange={e => { setSearchEngine(e.target.value); localStorage.setItem('browser_search_engine', e.target.value); }}
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-xs focus:outline-none"
                      >
                        {Object.keys(SEARCH_ENGINES).map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-outline uppercase tracking-widest block mb-1">SearXNG Instance (for PDF Search)</label>
                      <input
                        type="text"
                        value={searxngInstance}
                        onChange={e => setSearxngInstance(e.target.value)}
                        onBlur={() => localStorage.setItem('browser_searxng_instance', searxngInstance)}
                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-xs focus:outline-none focus:border-primary"
                        placeholder="https://searx.be (leave blank for auto)"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        const r = await window.electronAPI?.clearBrowserCache?.();
                        setShowSettings(false);
                        alert(r?.success ? 'Cache cleared!' : `Failed: ${r?.error}`);
                      }}
                      className="w-full py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all"
                    >
                      Clear Browsing Data
                    </button>
                  </div>
                  <p className="text-[9px] text-outline italic">Shortcuts: Ctrl+T new tab · Ctrl+W close · Ctrl+R reload · F12 DevTools</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <button 
          onClick={handleCapture}
          className="bg-primary text-on-primary px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 shadow-lg hover:opacity-90 active:scale-95 transition-all ml-1"
        >
          <Plus className="w-4 h-4" />
          Capture
        </button>
      </div>

      {/* Tabs Bar */}
      <div className="bg-surface-container-low flex items-center gap-0.5 px-2 pt-1 border-b border-outline-variant/10">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => {
              setActiveTabId(tab.id);
              setUrlInput(tab.url);
            }}
            className={`
              group flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-bold cursor-pointer transition-all min-w-[120px] max-w-[200px]
              ${activeTabId === tab.id ? 'bg-surface-container-lowest text-primary border-t border-x border-outline-variant/10' : 'text-on-surface-variant hover:bg-surface-container-high'}
            `}
          >
            {tab.isLoading ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Globe className="w-3 h-3 shrink-0" />}
            <span className="truncate flex-1">{tab.title}</span>
            <button 
              onClick={(e) => handleCloseTab(tab.id, e)}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-outline-variant/20 rounded-full transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button onClick={handleAddTab} className="p-2 hover:bg-surface-container-high rounded-full transition-colors ml-1">
          <Plus className="w-4 h-4 text-outline" />
        </button>
      </div>

      {/* Browser Content Area + Bookmarks Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 relative overflow-hidden">
          {isElectron ? (
            // Real Chromium webview in Electron with session partition
            tabs.map(tab => (
              <div key={tab.id} className={`absolute inset-0 ${activeTabId === tab.id ? '' : 'hidden'}`}>
                    <webview
                      ref={(el: any) => {
                        if (el && !webviewRefs.current[tab.id]) {
                          webviewRefs.current[tab.id] = el;
                          setupWebviewListeners(el, tab.id);
                        }
                      }}
                      src={tab.initialUrl}
                      className="w-full h-full transition-opacity duration-300"
                      // @ts-ignore
                      partition="persist:browser"
                      // Allow popups for known providers
                      // @ts-ignore
                      allowpopups={(tab.url?.includes('google.com') || tab.url?.includes('youtube.com') || tab.url?.includes('github.com')) ? 'true' : undefined}
                      // For YouTube, enable autoplay + disable background throttling to avoid blank/black playback
                      // @ts-ignore
                      webpreferences={(tab.url?.includes('youtube.com') || tab.url?.includes('youtu.be')) ? 'autoplayPolicy=no-user-gesture-required, backgroundThrottling=false' : undefined}
                      // Use a modern desktop UA for watch pages to avoid mobile/embedded fallbacks
                      // @ts-ignore
                      useragent={(tab.url?.includes('youtube.com') || tab.url?.includes('youtu.be')) ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' : undefined}
                    />
              </div>
            ))
          ) : (
            // Fallback for web browser (iframe-based, limited)
            <div className="w-full h-full">
              {activeTab?.url.includes('youtube.com') ? (
                <iframe 
                  src={activeTab.url.replace('watch?v=', 'embed/')}
                  className="w-full h-full border-none"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6 p-8">
                  <Globe className="w-20 h-20 text-outline-variant opacity-30" />
                  <div className="space-y-2">
                    <h2 className="text-2xl font-bold font-headline text-on-surface">Desktop Browser Required</h2>
                    <p className="text-on-surface-variant max-w-md">
                      The built-in browser uses Chromium and requires the desktop (Electron) version. 
                      For now, you can open links externally.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <a 
                      href={activeTab?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-primary text-on-primary px-6 py-3 rounded-full font-bold flex items-center gap-2 hover:opacity-90 transition-all"
                    >
                      <ExternalLink className="w-5 h-5" />
                      Open in System Browser
                    </a>
                  </div>
                  <p className="text-xs text-outline font-mono bg-surface-container-low px-4 py-2 rounded-lg">
                    {activeTab?.url}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bookmarks Sidebar */}
        <AnimatePresence>
          {showBookmarks && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-l border-outline-variant/10 bg-surface-container-low flex flex-col overflow-hidden shrink-0"
            >
              <div className="p-3 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
                <h3 className="text-xs font-bold uppercase tracking-widest text-outline flex items-center gap-2"><Bookmark className="w-3 h-3 text-primary" /> Bookmarks</h3>
                <button onClick={() => setShowBookmarks(false)} className="p-1 hover:bg-surface-container-high rounded text-outline transition-all">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 no-scrollbar min-w-[280px]">
                {bookmarks.length === 0 && (
                  <p className="text-[10px] text-outline text-center p-6 italic">No bookmarks yet.</p>
                )}
                {bookmarks.map(b => (
                  <div key={b.id} className="group flex items-center gap-2 p-2 rounded-lg hover:bg-surface-container-highest cursor-pointer transition-all" onClick={() => {
                     setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: b.url, title: b.title } : t));
                     setUrlInput(b.url);
                     if (webviewRefs.current[activeTabId]) {
                       webviewRefs.current[activeTabId].loadURL(b.url);
                     }
                  }}>
                    <Globe className="w-3 h-3 text-primary shrink-0 opacity-50" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-on-surface truncate">{b.title}</p>
                      <p className="text-[9px] text-outline truncate">{b.url}</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeBookmark(b.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-red-500 rounded transition-all shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status Bar */}
      <div className="bg-surface-container-low border-t border-outline-variant/10 px-4 py-1 flex items-center justify-between text-[10px] font-bold text-outline">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${activeTab?.url.startsWith('https://') ? 'bg-green-500' : 'bg-amber-500'}`}></div>
            <span>{activeTab?.url.startsWith('https://') ? 'Secure (HTTPS)' : 'Not Secure'}</span>
          </div>
          {activeTab?.isLoading && <span className="text-primary animate-pulse">Loading...</span>}
        </div>
        <div className="flex items-center gap-4">
          <span className="opacity-60">{isElectron ? 'Chromium Engine' : 'Web Fallback'}</span>
          <span>{Math.round(zoomLevel * 100)}% zoom</span>
          <span className="opacity-40">{searchEngine} search</span>
        </div>
      </div>

      {/* Capture Dialog */}
      <AnimatePresence>
        {showCaptureDialog && (
          <CaptureDialog 
            topics={topics}
            folders={folders}
            onCapture={doCapture}
            onClose={() => setShowCaptureDialog(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Capture Dialog ──────────────────────────────────────────

function CaptureDialog({ topics, folders, onCapture, onClose }: any) {
  const [topicId, setTopicId] = useState(topics[0]?.id || '');
  const [folderId, setFolderId] = useState('');
  const filteredFolders = folders.filter((f: any) => f.topicId === topicId);

  useEffect(() => {
    if (filteredFolders.length > 0 && !folderId) {
      setFolderId(filteredFolders[0].id);
    }
  }, [topicId, filteredFolders]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-on-surface/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-surface-container-lowest p-6 rounded-2xl shadow-2xl max-w-sm w-full space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-bold text-lg font-headline">Save to Library</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-widest block mb-1">Topic</label>
            <select value={topicId} onChange={e => { setTopicId(e.target.value); setFolderId(''); }} className="w-full bg-surface-container-low rounded-lg p-3 text-sm font-bold border-none focus:ring-1 focus:ring-primary">
              {topics.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-outline uppercase tracking-widest block mb-1">Folder</label>
            <select value={folderId} onChange={e => setFolderId(e.target.value)} className="w-full bg-surface-container-low rounded-lg p-3 text-sm font-bold border-none focus:ring-1 focus:ring-primary">
              {filteredFolders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 bg-surface-container-high rounded-xl text-sm font-bold hover:bg-surface-container-highest transition-all">Cancel</button>
          <button 
            onClick={() => { if (topicId && folderId) onCapture(topicId, folderId); }}
            disabled={!topicId || !folderId}
            className="flex-1 py-3 bg-primary text-on-primary rounded-xl text-sm font-bold hover:opacity-90 transition-all disabled:opacity-30"
          >
            Save
          </button>
        </div>
      </motion.div>
    </div>
  );
}
