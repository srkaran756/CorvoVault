import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, Video, FileText, PlayCircle, ExternalLink, X, StickyNote, Edit3, Trash2, Play, Link as LinkIcon, Loader2, AlertCircle, ChevronLeft, ChevronRight, Bold, Italic, List, ListOrdered, Image, Link, SendHorizontal, Pin } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMaterialNotes, useVideoProgress } from '../../hooks/useLocalData';
import { useActivityTimer } from '../../hooks/useActivityTimer';
import { Material } from '../../types';
import CustomPdfViewer from './CustomPdfViewer';

interface DocumentViewerProps {
  data: Material;
  isActive?: boolean;
}

export default function DocumentViewer({ data: material, isActive = true }: DocumentViewerProps) {
  const { user } = useAuth();
  const { notes, addNote, deleteNote, updateNote } = useMaterialNotes(material.id);
  const { progress: videoProgress, updateProgress } = useVideoProgress(material.id);

  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [useWebviewFallback, setUseWebviewFallback] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isNotesCollapsed, setIsNotesCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertFormat = (formatType: 'bold' | 'italic' | 'bullet' | 'number' | 'link' | 'image') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    let replacement = '';
    let cursorOffset = 0;

    switch (formatType) {
      case 'bold':
        replacement = `**${selectedText || 'bold text'}**`;
        cursorOffset = selectedText ? replacement.length : 2;
        break;
      case 'italic':
        replacement = `_${selectedText || 'italic text'}_`;
        cursorOffset = selectedText ? replacement.length : 1;
        break;
      case 'bullet':
        replacement = `\n- ${selectedText || 'List item'}`;
        cursorOffset = replacement.length;
        break;
      case 'number':
        replacement = `\n1. ${selectedText || 'List item'}`;
        cursorOffset = replacement.length;
        break;
      case 'link':
        const url = prompt("Enter URL:", "https://");
        if (url === null) return;
        replacement = `[${selectedText || 'link text'}](${url})`;
        cursorOffset = replacement.length;
        break;
      case 'image':
        const imgUrl = prompt("Enter Image URL:", "https://");
        if (imgUrl === null) return;
        replacement = `![${selectedText || 'image alt'}](${imgUrl})`;
        cursorOffset = replacement.length;
        break;
    }

    setNoteText(text.substring(0, start) + replacement + text.substring(end));
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
    }, 50);
  };

  // Well-being active time spent tracking — one timer, one category at a time.
  // Notes editing takes priority over the underlying media type when the user is
  // actively writing; otherwise the category is derived from the material type.
  const _timerCategory: import('../../hooks/useActivityTimer').WellbeingCategory =
    (isEditing && isActive) ? 'Notes' :
    material.boxType === 'youtube' ? 'YouTube' :
    material.boxType === 'file' ? 'Documents' : 'Notes';
  const _timerActive =
    isActive && (material.boxType === 'youtube' || material.boxType === 'file' || isEditing);
  useActivityTimer(_timerCategory, _timerActive);

  useEffect(() => {
    setMediaError(null);
    setUseWebviewFallback(false);
  }, [material.id]);

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addNote(noteText.trim());
    setNoteText('');
  };

  const startEditNote = (id: string, content: string) => {
    setEditingNoteId(id);
    setEditingNoteContent(content);
  };

  const confirmEditNote = (id: string) => {
    if (editingNoteContent.trim() && editingNoteId === id) {
      updateNote(id, editingNoteContent.trim());
    }
    setEditingNoteId(null);
    setEditingNoteContent('');
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteContent('');
  };

  const getFileSrc = useCallback((p: string | undefined | null) => {
    if (!p) return '';
    if (p.startsWith('corvovault-file://') || p.startsWith('file://') || p.startsWith('http') || p.startsWith('blob:')) {
      return p;
    }
    if (window.electronAPI) {
      const normalized = String(p).replace(/\\/g, '/');
      if (/^[A-Za-z]:\//.test(normalized)) {
        return `corvovault-file:///${normalized}`;
      }
      if (normalized.startsWith('/')) {
        return `corvovault-file://${normalized}`;
      }
      return `corvovault-file:///${normalized}`;
    }
    return p;
  }, []);

  const openExternally = () => {
    const targetUrl = material.localPath || material.url;
    if (window.electronAPI) window.electronAPI.openExternal(targetUrl);
    else window.open(targetUrl, '_blank');
  };

  const renderPlayer = () => {
    if (mediaError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant space-y-6 p-8">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center">
            <PlayCircle className="w-8 h-8 text-red-500 opacity-50" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold">Playback Issue</p>
            <p className="text-xs text-outline max-w-sm">{mediaError}</p>
          </div>
          <div className="flex gap-2.5">
            {material.boxType === 'youtube' && window.electronAPI && (
              <button
                onClick={() => { setMediaError(null); setUseWebviewFallback(true); }}
                className="bg-primary text-on-primary px-5 py-2 rounded-xl text-xs font-bold hover:scale-[1.02] transition-transform shadow-md"
              >
                Try Rescue Player
              </button>
            )}
            <button
              onClick={openExternally}
              className="bg-surface-container-high text-on-surface px-5 py-2 rounded-xl text-xs font-bold hover:scale-[1.02] transition-transform shadow-md"
            >
              Open Externally
            </button>
          </div>
        </div>
      );
    }

    if (material.boxType === 'youtube') {
      return useWebviewFallback && Boolean(window.electronAPI) ? (
        <YouTubeWebviewFallback url={material.url} startSeconds={videoProgress?.currentTime} />
      ) : (
        <YouTubeEmbed
          url={material.url}
          startSeconds={videoProgress?.currentTime}
          onError={(err, code) => {
            if (Boolean(window.electronAPI) && (code === 101 || code === 150)) {
              setUseWebviewFallback(true);
            } else {
              setMediaError(err);
            }
          }}
        />
      );
    }

    if (material.boxType === 'file') {
      const isVideo = /\.(mp4|webm|ogg|mkv|mov|m4v|avi)$/i.test(material.localPath || material.url);
      const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(material.localPath || material.url);
      const pathStr = (material.localPath || material.url || '');
      const isPdf = /\.pdf(\?.*)?$/i.test(pathStr);
      const isDocx = /\.(docx?|odt|rtf)$/i.test(material.localPath || material.url);

      if (isVideo) {
        return (
          <video
            src={getFileSrc(material.localPath || material.url)}
            className="w-full h-full object-contain bg-black"
            controls
            autoPlay
            onError={() => setMediaError("Failed to load video file.")}
            onTimeUpdate={(e) => {
              const target = e.target as HTMLVideoElement;
              if (Math.abs(target.currentTime - (videoProgress?.currentTime || 0)) > 5) {
                updateProgress(target.currentTime, target.duration);
              }
            }}
            onLoadedMetadata={(e) => {
              if (videoProgress && Math.abs(videoProgress.currentTime - (e.target as HTMLVideoElement).currentTime) > 2) {
                (e.target as HTMLVideoElement).currentTime = videoProgress.currentTime;
              }
            }}
          />
        );
      }

      if (isImage) {
        return (
          <img
            src={getFileSrc(material.localPath || material.url)}
            className="w-full h-full object-contain"
            alt={material.title}
          />
        );
      }

      if (isPdf) {
        return (
          <CustomPdfViewer
            material={material}
            getFileSrc={getFileSrc}
            isNotesCollapsed={isNotesCollapsed}
            setIsNotesCollapsed={setIsNotesCollapsed}
          />
        );
      }

      if (isDocx) {
        return (
          <DocxPreview
            material={material}
            isNotesCollapsed={isNotesCollapsed}
            setIsNotesCollapsed={setIsNotesCollapsed}
          />
        );
      }
    }

    if (material.boxType === 'link') {
      return window.electronAPI ? (
        <webview src={material.url} className="w-full h-full border-none" />
      ) : (
        <iframe src={material.url} className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin" />
      );
    }

    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant space-y-6 p-8">
        <FileText className="w-16 h-16 opacity-20" />
        <div className="text-center space-y-1">
          <p className="text-base font-bold">Unsupported Format</p>
          <p className="text-xs text-outline max-w-sm">Requires external app to preview.</p>
        </div>
        <button
          onClick={openExternally}
          className="bg-primary text-on-primary px-6 py-2.5 rounded-xl text-xs font-bold hover:scale-[1.02] transition-transform shadow-md"
        >
          Open in Default App
        </button>
      </div>
    );
  };

  return (
    <div className="h-full flex bg-surface-container-lowest overflow-hidden">
      {/* Left Column: Player */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface-dim h-full">
        {/* Quick Toolbar */}
        <div className="h-9 px-4 flex justify-between items-center bg-surface border-b border-outline-variant/10 select-none shrink-0">
          {/* Breadcrumb path */}
          <div className="flex items-center gap-1.5 text-outline text-[10px] font-medium tracking-tight min-w-0">
            <span className="shrink-0">Vault</span>
            <span className="opacity-40 shrink-0">/</span>
            <span className="capitalize shrink-0">{material.boxType}</span>
            <span className="opacity-40 shrink-0">/</span>
            <span className="text-on-surface font-semibold truncate" title={material.title}>
              {material.title}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
              onClick={openExternally}
              className="p-1.5 hover:bg-surface-container-high text-outline hover:text-primary rounded-lg transition-all flex items-center justify-center cursor-pointer"
              title="Open Externally"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            {/* Notes toggle — lives in the toolbar, never floats outside its container */}
            <button
              onClick={() => setIsNotesCollapsed(!isNotesCollapsed)}
              className={`p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer ${
                isNotesCollapsed
                  ? 'text-outline hover:bg-surface-container-high hover:text-primary'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title={isNotesCollapsed ? 'Show Notes' : 'Hide Notes'}
            >
              <StickyNote className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Media Container — fills remaining height, no overflow bleed */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderPlayer()}
        </div>
      </div>

      {/* Right Column: Notes Panel — no absolute-positioned children */}
      <div className={`flex flex-col shrink-0 h-full border-l border-outline-variant/10 bg-surface-container-low transition-[width,opacity] duration-300 ease-in-out ${
        isNotesCollapsed ? 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none' : 'w-72 opacity-100'
      }`}>
        {/* Panel header */}
        <div className="p-3.5 border-b border-outline-variant/10 flex items-center justify-between shrink-0 select-none">
          <h4 className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2 text-on-surface font-headline">
            <StickyNote className="w-3.5 h-3.5 text-primary" />
            Lecture Notes
          </h4>
          <div className="flex items-center gap-1 text-outline">
            <button className="p-1 hover:bg-surface-container-high text-outline hover:text-on-surface rounded-lg transition-colors" title="Pin Note">
              <Pin className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsNotesCollapsed(true)}
              className="p-1 hover:bg-surface-container-high text-outline hover:text-on-surface rounded-lg transition-colors"
              title="Collapse Sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable notes list */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5 no-scrollbar">
          {notes.length === 0 && (
            <p className="text-[10px] text-outline italic p-2">No notes logged yet. Write below.</p>
          )}
          {notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              editingNoteId={editingNoteId}
              editingNoteContent={editingNoteContent}
              setEditingNoteContent={setEditingNoteContent}
              startEditNote={startEditNote}
              confirmEditNote={confirmEditNote}
              cancelEditNote={cancelEditNote}
              deleteNote={deleteNote}
              setIsEditing={setIsEditing}
            />
          ))}
        </div>

        {/* Note input box */}
        <div className="p-3 border-t border-outline-variant/10 shrink-0 select-none bg-surface-container-low">
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
            <textarea
              ref={textareaRef}
              className="w-full h-20 bg-transparent p-3 text-xs resize-none focus:outline-none placeholder:text-outline/70"
              placeholder="Write your note..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { handleAddNote(); } }}
              onFocus={() => setIsEditing(true)}
              onBlur={() => setIsEditing(false)}
            />
            {/* Formatting toolbar inside card */}
            <div className="flex items-center justify-between px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/5">
              <div className="flex items-center gap-1.5 text-outline">
                <button onClick={() => insertFormat('bold')} className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer" title="Bold">
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => insertFormat('italic')} className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer" title="Italic">
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => insertFormat('bullet')} className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer" title="Bulleted List">
                  <List className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => insertFormat('number')} className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer" title="Numbered List">
                  <ListOrdered className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => insertFormat('link')} className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer" title="Add Link">
                  <Link className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => insertFormat('image')} className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer" title="Add Image">
                  <Image className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim()}
                className="p-2 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-30 disabled:pointer-events-none hover:opacity-90 hover:scale-[1.03] active:scale-[0.98] transition-all shadow-md flex items-center justify-center cursor-pointer"
                title="Add Note (Ctrl+Enter)"
              >
                <SendHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Player Subcomponents ---

function YouTubeEmbed({ url, startSeconds, onError }: { url: string; startSeconds?: number; onError: (msg: string, code?: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  // Store transient parameters in refs to prevent triggering full player reinitializations
  const onErrorRef = useRef(onError);
  const startSecondsRef = useRef(startSeconds);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    startSecondsRef.current = startSeconds;
  }, [startSeconds]);

  useEffect(() => {
    let mounted = true;
    const getPlayer = () => {
      let id = '';
      if (url.includes('v=')) id = url.split('v=')[1]?.split('&')[0];
      else if (url.includes('youtu.be/')) id = url.split('youtu.be/')[1]?.split('?')[0];

      if (!id) {
        onErrorRef.current("Invalid YouTube URL.");
        setLoading(false);
        return;
      }

      if (!(window as any).YT || !(window as any).YT.Player) return;

      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          start: Math.floor(startSecondsRef.current || 0),
          rel: 0,
          modestbranding: 1,
          origin: window.location.protocol === 'file:' ? 'https://www.youtube.com' : window.location.origin,
        },
        events: {
          onReady: () => { if (mounted) setLoading(false); },
          onError: (e: any) => {
            if (!mounted) return;
            setLoading(false);
            const code = e.data;
            let msg = "Could not play video.";
            if (code === 2) msg = "Invalid video ID.";
            if (code === 100) msg = "Video not found or private.";
            if (code === 101 || code === 150) msg = "Embedding restricted by owner.";
            onErrorRef.current(msg, code);
          }
        }
      });
    };

    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    const checkApi = setInterval(() => {
      if ((window as any).YT && (window as any).YT.Player && !playerRef.current) {
        clearInterval(checkApi);
        getPlayer();
      }
    }, 200);

    return () => {
      mounted = false;
      clearInterval(checkApi);
      if (playerRef.current?.destroy) playerRef.current.destroy();
    };
  }, [url]);

  return (
    <div className="w-full h-full relative bg-black">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-dim z-10">
          <div className="relative">
            <div className="w-10 h-10 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 w-10 h-10 border-4 border-transparent border-t-primary rounded-full animate-spin" />
          </div>
          <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-outline">Loading Cinema...</p>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

function YouTubeWebviewFallback({ url, startSeconds }: { url: string; startSeconds?: number }) {
  const webviewRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const inject = () => {
      const css = `
        html, body, ytd-app, #content, #page-manager {
            background: #000000 !important;
            overflow: hidden !important;
        }
        #masthead-container, ytd-masthead, #masthead, #below, #info, #above-the-fold, ytd-watch-metadata, ytd-comments, #comments, #related, #secondary, #footer { display: none !important; }
        html, body, ytd-app, #content, #page-manager, ytd-watch-flexy, #full-bleed-container {
            height: 100vh !important;
        }
        #columns, #primary, #primary-inner, #player-container-outer, #player-container-inner, #ytd-player, #player-container, #player, ytd-player, .ytd-player, #movie_player, .html5-video-player {
            width: 100% !important;
            height: 100% !important;
        }
      `;
      webview.insertCSS(css);
      webview.executeJavaScript(`
        (function() {
          if (window._sicWatchInjected) return;
          window._sicWatchInjected = true;
          const skipAds = () => {
            const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
            if (skipBtn) { skipBtn.click(); }
          };
          setInterval(skipAds, 800);
        })();
      `);
    };

    webview.addEventListener('dom-ready', inject);
    webview.addEventListener('did-finish-load', () => setIsReady(true));
    return () => {
      webview.removeEventListener('dom-ready', inject);
    };
  }, []);

  let watchId = '';
  try {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|v\/)([^?&]+)/);
    if (match) watchId = match[1];
  } catch (e) { }

  let watchUrl = watchId ? `https://www.youtube.com/watch?v=${watchId}` : url;
  if (watchId && startSeconds) watchUrl += `&t=${Math.floor(startSeconds)}s`;

  return (
    <div className="w-full h-full bg-black relative">
      <webview
        ref={webviewRef}
        src={watchUrl}
        className={`w-full h-full transition-opacity duration-500 ${isReady ? 'opacity-100' : 'opacity-0'}`}
        partition="persist:youtube_player"
        // @ts-ignore
        allowpopups="true"
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      />
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50 space-y-3">
          <div className="w-10 h-10 border-4 border-transparent border-t-primary rounded-full animate-spin" />
          <p className="text-[10px] text-primary/60 font-black uppercase tracking-widest">Rescue Mode...</p>
        </div>
      )}
    </div>
  );
}

function DocxPreview({
  material,
  isNotesCollapsed,
  setIsNotesCollapsed,
}: {
  material: Material;
  isNotesCollapsed?: boolean;
  setIsNotesCollapsed?: (collapsed: boolean) => void;
}) {
  const filePath = material.localPath || material.url;
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; pdfPath?: string; errorMessage?: string }>({ status: 'loading' });

  const getFileSrc = useCallback((p: string | undefined | null) => {
    if (!p) return '';
    if (p.startsWith('corvovault-file://') || p.startsWith('file://') || p.startsWith('http') || p.startsWith('blob:')) {
      return p;
    }
    if (window.electronAPI) {
      const normalized = String(p).replace(/\\/g, '/');
      if (/^[A-Za-z]:\//.test(normalized)) {
        return `corvovault-file:///${normalized}`;
      }
      if (normalized.startsWith('/')) {
        return `corvovault-file://${normalized}`;
      }
      return `corvovault-file:///${normalized}`;
    }
    return p;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function convert() {
      if (!window.electronAPI?.convertDocxToHtml) {
        setState({ status: 'error', errorMessage: 'Preview is only available in desktop app.' });
        return;
      }
      try {
        const result = await window.electronAPI.convertDocxToHtml(filePath);
        if (cancelled) return;
        if (result.success && result.path) {
          setState({ status: 'ready', pdfPath: result.path });
        } else {
          setState({ status: 'error', errorMessage: result.errorMessage || 'Conversion failed.' });
        }
      } catch (err: any) {
        if (!cancelled) setState({ status: 'error', errorMessage: err.message });
      }
    }
    convert();
    return () => { cancelled = true; };
  }, [filePath]);

  if (state.status === 'loading') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-transparent border-t-primary rounded-full animate-spin" />
        <p className="text-xs text-outline">Converting docx to HTML...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-bold text-red-500">Preview Failed</p>
        <p className="text-xs text-outline">{state.errorMessage}</p>
      </div>
    );
  }

  if (state.pdfPath) {
    return (
      <CustomPdfViewer
        material={material}
        pdfPath={state.pdfPath}
        getFileSrc={getFileSrc}
        isNotesCollapsed={isNotesCollapsed}
        setIsNotesCollapsed={setIsNotesCollapsed}
      />
    );
  }
  return null;
}

// --- Collapsible Note Item ---
function NoteCard({
  note,
  editingNoteId,
  editingNoteContent,
  setEditingNoteContent,
  startEditNote,
  confirmEditNote,
  cancelEditNote,
  deleteNote,
  setIsEditing,
}: {
  note: any;
  editingNoteId: string | null;
  editingNoteContent: string;
  setEditingNoteContent: (content: string) => void;
  startEditNote: (id: string, content: string) => void;
  confirmEditNote: (id: string) => void;
  cancelEditNote: () => void;
  deleteNote: (id: string) => void;
  setIsEditing: (val: boolean) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isEditing = editingNoteId === note.id;
  const contentLimit = 250;
  const isLong = note.content.length > contentLimit || note.content.split('\n').length > 5;

  const displayContent = isExpanded || !isLong
    ? note.content
    : note.content.slice(0, contentLimit).trim() + '...';

  const { renderedElements, tags } = parseRichText(displayContent);

  return (
    <div className="p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/15 group shadow-sm transition-all hover:shadow-md flex flex-col gap-2 relative">
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            className="w-full h-28 bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-xs resize-none focus:outline-none focus:border-primary"
            value={editingNoteContent}
            onChange={(e) => setEditingNoteContent(e.target.value)}
            onFocus={() => setIsEditing(true)}
            onBlur={() => setIsEditing(false)}
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={() => confirmEditNote(note.id)} className="flex-1 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90">Save</button>
            <button onClick={cancelEditNote} className="flex-1 py-1.5 bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg hover:bg-outline-variant/20">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* Rich Content elements */}
          <div className="flex flex-col gap-1">
            {renderedElements}
          </div>

          {/* Tags Pills Badges */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-primary/5 text-primary text-[9px] font-bold rounded-full border border-primary/10 select-none">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {isLong && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 text-[10px] text-primary font-bold hover:underline block self-start"
            >
              {isExpanded ? 'Show less' : 'Read more'}
            </button>
          )}

          {/* Footer of Note Card */}
          <div className="flex items-center justify-between mt-2 pt-2.5 border-t border-outline-variant/5">
            <span className="text-[9px] text-outline/80 font-semibold select-none">
              {new Date(note.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} • {new Date(note.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
            <div className="opacity-0 group-hover:opacity-100 flex gap-1.5 transition-all">
              <button
                onClick={() => startEditNote(note.id, note.content)}
                className="p-1 hover:bg-surface-container-high text-outline hover:text-primary rounded transition-all"
                title="Edit"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => deleteNote(note.id)}
                className="p-1 hover:bg-red-50 text-red-500 rounded transition-all"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Custom Rich Text Markdown Parser ---
function parseRichText(text: string) {
  const tagRegex = /#([a-zA-Z0-9_-]+)/g;
  const tags: string[] = [];
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    tags.push(match[1]);
  }

  const lines = text.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];
  let isBulletList = false;
  let isNumberedList = false;

  const pushCurrentList = (key: number) => {
    if (currentList.length > 0) {
      if (isBulletList) {
        renderedElements.push(
          <ul key={`bullet-${key}`} className="list-disc pl-2 space-y-1 my-1.5 text-xs text-on-surface-variant leading-relaxed">
            {currentList}
          </ul>
        );
      } else if (isNumberedList) {
        renderedElements.push(
          <ol key={`numbered-${key}`} className="list-decimal pl-5 space-y-1 my-1.5 text-xs text-on-surface-variant leading-relaxed">
            {currentList}
          </ol>
        );
      }
      currentList = [];
      isBulletList = false;
      isNumberedList = false;
    }
  };

  const inlineParse = (str: string) => {
    let parts: { type: 'text' | 'bold' | 'italic' | 'link'; content: string; url?: string }[] = [{ type: 'text', content: str }];

    parts = parts.flatMap((p): any => {
      if (p.type !== 'text') return p;
      const subparts = p.content.split(/\*\*([\s\S]*?)\*\*/g);
      return subparts.map((content, idx) => ({
        type: idx % 2 === 1 ? 'bold' as const : 'text' as const,
        content
      }));
    });

    parts = parts.flatMap((p): any => {
      if (p.type !== 'text') return p;
      const subparts = p.content.split(/_([\s\S]*?)_/g);
      return subparts.map((content, idx) => ({
        type: idx % 2 === 1 ? 'italic' as const : 'text' as const,
        content
      }));
    });

    parts = parts.flatMap((p): any => {
      if (p.type !== 'text') return p;
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      const result = [];
      let lastIndex = 0;
      let m;
      while ((m = linkRegex.exec(p.content)) !== null) {
        if (m.index > lastIndex) {
          result.push({ type: 'text' as const, content: p.content.substring(lastIndex, m.index) });
        }
        result.push({ type: 'link' as const, content: m[1], url: m[2] });
        lastIndex = linkRegex.lastIndex;
      }
      if (lastIndex < p.content.length) {
        result.push({ type: 'text' as const, content: p.content.substring(lastIndex) });
      }
      return result.length > 0 ? result : p;
    });

    return parts.map((p, idx) => {
      if (p.type === 'bold') return <strong key={idx} className="font-extrabold text-on-surface">{p.content}</strong>;
      if (p.type === 'italic') return <em key={idx} className="italic text-on-surface-variant">{p.content}</em>;
      if (p.type === 'link') return (
        <a key={idx} href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-semibold inline-flex items-center gap-0.5 break-all">
          {p.content}
        </a>
      );
      return p.content;
    });
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      pushCurrentList(idx);
      return;
    }

    if (trimmed.split(/\s+/).every(word => word.startsWith('#'))) {
      return;
    }

    if (trimmed.startsWith('# ')) {
      pushCurrentList(idx);
      renderedElements.push(
        <h4 key={idx} className="text-sm font-extrabold text-on-surface mt-2 mb-1.5 tracking-tight font-headline">
          {inlineParse(trimmed.slice(2))}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      pushCurrentList(idx);
      renderedElements.push(
        <h5 key={idx} className="text-xs font-bold text-on-surface mt-2 mb-1 tracking-tight font-headline">
          {inlineParse(trimmed.slice(3))}
        </h5>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!isBulletList) {
        pushCurrentList(idx);
        isBulletList = true;
      }
      currentList.push(
        <li key={idx} className="text-xs text-on-surface-variant leading-relaxed list-none flex items-start gap-1.5 py-0.5">
          <span className="text-primary shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="flex-1 break-words">{inlineParse(trimmed.slice(2))}</span>
        </li>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!isNumberedList) {
        pushCurrentList(idx);
        isNumberedList = true;
      }
      const match = trimmed.match(/^(\d+)\.\s(.*)/);
      currentList.push(
        <li key={idx} className="text-xs text-on-surface-variant leading-relaxed list-none flex items-start gap-2 py-0.5">
          <span className="text-primary font-bold text-[10px] shrink-0 mt-0.5 w-4">{match ? match[1] : '1'}.</span>
          <span className="flex-1 break-words">{inlineParse(match ? match[2] : trimmed)}</span>
        </li>
      );
    } else {
      pushCurrentList(idx);
      renderedElements.push(
        <p key={idx} className="text-xs text-on-surface-variant leading-relaxed mb-2 break-words">
          {inlineParse(line)}
        </p>
      );
    }
  });

  pushCurrentList(lines.length);

  return { renderedElements, tags };
}

