import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, Video, FileText, PlayCircle, ExternalLink, X, StickyNote, Edit3, Trash2, Play, Link as LinkIcon, Loader2, AlertCircle, ChevronLeft, ChevronRight, Bold, Italic, List, ListOrdered, Image, Link, SendHorizontal, Pin, Camera, Search, Eraser } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMaterialNotes, useVideoProgress } from '../../hooks/useLocalData';
import { useActivityTimer } from '../../hooks/useActivityTimer';
import { Material } from '../../types';
import CustomPdfViewer from './CustomPdfViewer';
import { ipcService } from '../../services/ipcService';
import { htmlToMarkdown, markdownToHtml, parseRichText, searchWebImages } from '../../lib/editorUtils';

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
  const [isNotesPinned, setIsNotesPinned] = useState(false);

  // Link dialog states
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkTab, setLinkTab] = useState<'material' | 'web'>('material');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkDisplayName, setLinkDisplayName] = useState('');
  const [linkWebUrl, setLinkWebUrl] = useState('https://');
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);

  // Image dialog states
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageWebUrl, setImageWebUrl] = useState('https://');
  const [imageTab, setImageTab] = useState<'local' | 'search' | 'url'>('local');
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageSearchResults, setImageSearchResults] = useState<string[]>([]);
  const [imageSearchLoading, setImageSearchLoading] = useState(false);

  const handleWebImageSearch = async () => {
    if (!imageSearchQuery.trim()) return;
    setImageSearchLoading(true);
    const urls = await searchWebImages(imageSearchQuery);
    setImageSearchResults(urls);
    setImageSearchLoading(false);
  };

  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    bullet: false,
    number: false,
  });

  const updateActiveFormats = () => {
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      bullet: document.queryCommandState('insertUnorderedList'),
      number: document.queryCommandState('insertOrderedList'),
    });
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const parent = range.commonAncestorContainer;
        const editorEl = editorRef.current;
        if (editorEl && (editorEl === parent || editorEl.contains(parent))) {
          savedRangeRef.current = range.cloneRange();
          updateActiveFormats();
          return;
        }
      }
      setActiveFormats({ bold: false, italic: false, bullet: false, number: false });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  const editorRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<any>(null);
  const notesScrollRef = useRef<HTMLDivElement>(null);
  // Save editor selection before modal buttons steal focus
  const savedRangeRef = useRef<Range | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const saveEditorRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const editorEl = editorRef.current;
      if (editorEl && (editorEl === range.commonAncestorContainer || editorEl.contains(range.commonAncestorContainer))) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  };

  const restoreEditorRange = () => {
    const range = savedRangeRef.current;
    if (!range || !editorRef.current) return;
    editorRef.current.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  useEffect(() => {
    if (user && linkModalOpen) {
      ipcService.vault.getAllMaterials(user.id).then(setAllMaterials);
    }
  }, [user, linkModalOpen]);

  const filteredMaterials = allMaterials.filter(m => 
    m.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
  );

  const applyFormat = (command: string, value: string = '') => {
    restoreEditorRange();
    document.execCommand(command, false, value);
    handleEditorInput();
    updateActiveFormats();
  };

  const insertLinkFormat = (type: 'material' | 'web', value: string, title?: string) => {
    restoreEditorRange();
    if (type === 'material') {
      const url = `corvovault-material://${value}`;
      const text = title || 'Linked Material';
      const html = `<a href="${url}" class="text-primary hover:underline font-semibold">${text}</a>`;
      document.execCommand('insertHTML', false, html);
    } else {
      const text = linkDisplayName || value;
      const html = `<a href="${value}" class="text-primary hover:underline font-semibold">${text}</a>`;
      document.execCommand('insertHTML', false, html);
    }
    handleEditorInput();
    setLinkModalOpen(false);
    setLinkSearchQuery('');
    setLinkDisplayName('');
    setLinkWebUrl('https://');
  };

  const insertImageFormat = (url: string) => {
    const src = getFileSrc(url);
    const html = `<img src="${src}" alt="image" style="max-width:100%; height:auto; border-radius: 8px; margin: 4px 0;" />`;
    restoreEditorRange();
    document.execCommand('insertHTML', false, html);
    handleEditorInput();
    setImageModalOpen(false);
    setImageWebUrl('https://');
  };

  const handleImportLocalImage = async () => {
    if (!window.electronAPI) {
      alert('Local image import is only available in the desktop app.');
      return;
    }
    try {
      const result = await window.electronAPI.openFileDialog({
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return;
      const localData = await window.electronAPI.copyFileToLocal(result.filePaths[0]);
      insertImageFormat(localData.localPath);
    } catch (err: any) {
      alert(`Failed to import image: ${err.message}`);
    }
  };

  const handleCapturePdfPage = async (type: 'full' | 'crop') => {
    if (!pdfViewerRef.current) return;
    try {
      if (type === 'crop') {
        saveEditorRange();
        setImageModalOpen(false);
        pdfViewerRef.current.startCropMode();
      } else {
        saveEditorRange();
        setIsCapturing(true);
        setImageModalOpen(false);
        // Small delay to let the modal close before we capture
        await new Promise(resolve => setTimeout(resolve, 100));
        const dataUrl = await pdfViewerRef.current.captureCurrentPage();
        setIsCapturing(false);
        if (!dataUrl) {
          alert('Could not capture — make sure the PDF page is visible.');
          return;
        }
        if (window.electronAPI?.saveBase64) {
          const localPath = await window.electronAPI.saveBase64(dataUrl, 'pdf_screenshot.png');
          insertImageFormat(localPath);
        } else {
          insertImageFormat(dataUrl);
        }
      }
    } catch (err: any) {
      setIsCapturing(false);
      alert(`Capture failed: ${err.message}`);
    }
  };

  const handleAddImageFromSelection = async (dataUrl: string) => {
    try {
      if (window.electronAPI?.saveBase64) {
        const localPath = await window.electronAPI.saveBase64(dataUrl, 'pdf_screenshot.png');
        insertImageFormat(localPath);
      } else {
        insertImageFormat(dataUrl);
      }
      // Open notes panel if it was collapsed
      if (isNotesCollapsed) setIsNotesCollapsed(false);
    } catch (err: any) {
      alert(`Failed to save screenshot: ${err.message}`);
    }
  };

  const handleEditorInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      const markdown = htmlToMarkdown(html);
      setNoteText(markdown);
    }
  };

  const handleLinkClick = (url: string) => {
    const materialId = url.replace('corvovault-material://', '');
    if (user) {
      ipcService.vault.getAllMaterials(user.id).then(allMaterials => {
        const mat = allMaterials.find((m: any) => m.id === materialId);
        if (mat) {
          const type = mat.boxType === 'note' ? 'note' : 'document';
          window.dispatchEvent(new CustomEvent('corvovault:switch-tab', { 
            detail: { 
              tab: { 
                type, 
                title: mat.title, 
                data: mat 
              } 
            } 
          }));
        } else {
          alert('Linked material not found.');
        }
      });
    }
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
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
    setTimeout(() => {
      if (notesScrollRef.current) {
        notesScrollRef.current.scrollTop = notesScrollRef.current.scrollHeight;
      }
    }, 100);
  };

  const startEditNote = (id: string, content: string) => {
    setEditingNoteId(id);
    setEditingNoteContent(content);
  };

  const confirmEditNote = (id: string, updatedContent: string) => {
    if (updatedContent.trim() && editingNoteId === id) {
      updateNote(id, updatedContent.trim());
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
      const pathStr = (material.localPath || material.url || '');
      const isRemoteOnly = !material.localPath && /^https?:/i.test(material.url);
      const isVideo = /\.(mp4|webm|ogg|mkv|mov|m4v|avi)$/i.test(pathStr);
      const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(pathStr);
      const isPdf = /\.pdf(\?.*)?$/i.test(pathStr);
      const isDocx = /\.(docx?|odt|rtf)$/i.test(pathStr);

      // If this file hasn't been downloaded yet (no localPath), it's a remote
      // URL from the Course Explorer. Render it in a webview so it loads
      // natively — exactly like the 'link' box type. No CORS, no encryption
      // pipeline issues. Once downloaded (localPath is set), it routes through
      // the full local viewers below with AI features enabled.
      if (isRemoteOnly) {
        return window.electronAPI ? (
          <webview src={material.url} className="w-full h-full border-none" />
        ) : (
          <iframe src={material.url} className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin allow-forms" />
        );
      }

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
            ref={pdfViewerRef}
            material={material}
            getFileSrc={getFileSrc}
            isNotesCollapsed={isNotesCollapsed}
            setIsNotesCollapsed={setIsNotesCollapsed}
            isNotesPinned={isNotesPinned}
            onAddNoteFromSelection={(text) => {
              setIsNotesCollapsed(false);
              if (editorRef.current) {
                const currentHtml = editorRef.current.innerHTML;
                const isPlaceholder = currentHtml === '' || currentHtml === '<br>' || editorRef.current.innerText.trim() === '';
                const appendHtml = `<div>${text}</div>`;
                if (isPlaceholder) {
                  editorRef.current.innerHTML = appendHtml;
                } else {
                  editorRef.current.innerHTML += appendHtml;
                }
                handleEditorInput();
                
                setTimeout(() => {
                  editorRef.current?.focus();
                  const range = document.createRange();
                  const sel = window.getSelection();
                  range.selectNodeContents(editorRef.current!);
                  range.collapse(false);
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }, 50);
              }
            }}
            onAddImageFromSelection={handleAddImageFromSelection}
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
        <div className="w-72 h-full flex flex-col">
          {/* Panel header */}
        <div className="p-3.5 border-b border-outline-variant/10 flex items-center justify-between shrink-0 select-none">
          <h4 className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2 text-on-surface font-headline">
            <StickyNote className="w-3.5 h-3.5 text-primary" />
            Lecture Notes
          </h4>
          <div className="flex items-center gap-1 text-outline">
            <button 
              onClick={() => setIsNotesPinned(!isNotesPinned)}
              className={`p-1 hover:bg-surface-container-high rounded-lg transition-colors cursor-pointer ${
                isNotesPinned ? 'text-primary' : 'text-outline hover:text-on-surface'
              }`}
              title={isNotesPinned ? "Unpin notes panel" : "Pin notes panel side-by-side"}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsNotesCollapsed(true)}
              className="p-1 hover:bg-surface-container-high text-outline hover:text-on-surface rounded-lg transition-colors cursor-pointer"
              title="Collapse Sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable notes list */}
        <div ref={notesScrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5 no-scrollbar">
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
              getFileSrc={getFileSrc}
              onLinkClick={handleLinkClick}
            />
          ))}
        </div>

        {/* Note input box */}
        <div className="p-3 border-t border-outline-variant/10 shrink-0 bg-surface-container-low relative">
          {/* Full-page capture loading indicator */}
          {isCapturing && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/90 z-50 rounded-t-xl">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-[9px] font-black uppercase tracking-widest text-primary">Capturing...</span>
              </div>
            </div>
          )}
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all relative">
            <div
              ref={editorRef}
              contentEditable
              onInput={handleEditorInput}
              onFocus={() => setIsEditing(true)}
              onBlur={() => { setIsEditing(false); saveEditorRange(); }}
              className="w-full min-h-20 max-h-40 bg-transparent p-3 text-xs focus:outline-none overflow-y-auto rich-editor text-on-surface"
              style={{ outline: 'none' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault();
                  handleAddNote();
                }
              }}
            />
            {!noteText && (
              <div className="absolute top-3 left-3 text-xs text-outline/50 pointer-events-none select-none">
                Write your note...
              </div>
            )}

            {/* Link insert dialog overlay */}
            {linkModalOpen && (
              <div className="absolute inset-x-2 bottom-12 bg-surface border border-outline-variant/20 rounded-xl p-3 shadow-lg z-50 flex flex-col gap-2 animate-in slide-in-from-bottom-2 duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase text-primary tracking-wider">Insert Link</span>
                  <button 
                    type="button" 
                    onClick={() => setLinkModalOpen(false)} 
                    className="text-outline hover:text-on-surface"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <div className="flex bg-surface-container-low p-0.5 rounded-lg border border-outline-variant/10">
                  <button 
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setLinkTab('material')}
                    className={`flex-1 py-1 text-[9px] font-bold uppercase rounded-md transition-all ${
                      linkTab === 'material' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Material
                  </button>
                  <button 
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setLinkTab('web')}
                    className={`flex-1 py-1 text-[9px] font-bold uppercase rounded-md transition-all ${
                      linkTab === 'web' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Web URL
                  </button>
                </div>

                {linkTab === 'material' ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search materials..."
                        value={linkSearchQuery}
                        onChange={e => setLinkSearchQuery(e.target.value)}
                        className="w-full text-[10px] p-1.5 pl-6 border border-outline-variant/20 rounded-lg bg-surface focus:outline-none focus:border-primary text-on-surface"
                      />
                      <Search className="w-3 h-3 text-outline absolute left-2 top-2.5" />
                    </div>
                    <div className="max-h-24 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin">
                      {filteredMaterials.length === 0 ? (
                        <p className="text-[9px] text-outline text-center py-2 italic">No materials found.</p>
                      ) : (
                        filteredMaterials.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => insertLinkFormat('material', m.id, m.title)}
                            className="w-full text-left p-1 hover:bg-surface-container-high rounded text-[10px] text-on-surface font-medium truncate flex items-center gap-1.5 cursor-pointer"
                          >
                            <FileText className="w-3 h-3 text-outline" />
                            <span className="truncate">{m.title}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="text"
                      placeholder="Display text (optional)..."
                      value={linkDisplayName}
                      onChange={e => setLinkDisplayName(e.target.value)}
                      className="w-full text-[10px] p-1.5 border border-outline-variant/20 rounded-lg bg-surface focus:outline-none focus:border-primary text-on-surface"
                    />
                    <input
                      type="text"
                      placeholder="URL (https://...)"
                      value={linkWebUrl}
                      onChange={e => setLinkWebUrl(e.target.value)}
                      className="w-full text-[10px] p-1.5 border border-outline-variant/20 rounded-lg bg-surface focus:outline-none focus:border-primary text-on-surface"
                    />
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => insertLinkFormat('web', linkWebUrl)}
                      className="w-full py-1 bg-primary text-on-primary text-[10px] font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer"
                    >
                      Insert Link
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Image insert dialog overlay */}
            {imageModalOpen && (
              <div className="absolute inset-x-2 bottom-12 bg-surface border border-outline-variant/20 rounded-xl p-3 shadow-lg z-50 flex flex-col gap-2.5 animate-in slide-in-from-bottom-2 duration-150 max-h-[220px] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase text-primary tracking-wider">Insert Image</span>
                  <button 
                    type="button" 
                    onClick={() => setImageModalOpen(false)} 
                    className="text-outline hover:text-on-surface"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Sub-tab Navigation */}
                <div className="flex bg-surface-container-low p-0.5 rounded-lg border border-outline-variant/10">
                  <button 
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setImageTab('local')}
                    className={`flex-1 py-0.5 text-[8px] font-bold uppercase rounded-md transition-all ${
                      imageTab === 'local' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Local / PDF
                  </button>
                  <button 
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setImageTab('search')}
                    className={`flex-1 py-0.5 text-[8px] font-bold uppercase rounded-md transition-all ${
                      imageTab === 'search' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Search Web
                  </button>
                  <button 
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setImageTab('url')}
                    className={`flex-1 py-0.5 text-[8px] font-bold uppercase rounded-md transition-all ${
                      imageTab === 'url' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Web URL
                  </button>
                </div>

                {/* Tab content */}
                {imageTab === 'local' && (
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={handleImportLocalImage}
                      className="w-full py-1.5 bg-surface-container border border-outline-variant/10 hover:bg-surface-container-high text-on-surface text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Image className="w-3.5 h-3.5 text-primary" />
                      Import Local Image
                    </button>

                    {/* Capture PDF Page options */}
                    {/\.pdf(\?.*)?$/i.test(material.localPath || material.url || '') && (
                      <div className="flex flex-col gap-1 border-t border-outline-variant/10 pt-1.5">
                        <span className="text-[8px] text-outline font-bold uppercase tracking-wider mb-0.5">PDF Screenshot</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleCapturePdfPage('full')}
                            className="flex-1 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-[9px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer font-semibold"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Full Page
                          </button>
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleCapturePdfPage('crop')}
                            className="flex-1 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-[9px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer font-semibold"
                          >
                            <Search className="w-3.5 h-3.5" />
                            Crop Area
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {imageTab === 'search' && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        placeholder="Search open-source images..."
                        value={imageSearchQuery}
                        onChange={e => setImageSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleWebImageSearch();
                          }
                        }}
                        className="flex-1 text-[10px] p-1 border border-outline-variant/20 rounded-lg bg-surface focus:outline-none focus:border-primary text-on-surface"
                      />
                      <button
                        type="button"
                        onClick={handleWebImageSearch}
                        className="px-2.5 py-1 bg-primary text-on-primary text-[9px] font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer flex items-center justify-center"
                      >
                        Search
                      </button>
                    </div>

                    {imageSearchLoading ? (
                      <div className="py-4 flex justify-center items-center">
                        <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : imageSearchResults.length > 0 ? (
                      <div className="grid grid-cols-4 gap-1.5 max-h-[100px] overflow-y-auto p-0.5 border border-outline-variant/10 rounded-lg">
                        {imageSearchResults.map((url, idx) => (
                          <div 
                            key={idx}
                            onClick={() => insertImageFormat(url)}
                            className="aspect-square bg-surface-container rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all relative group"
                          >
                            <img src={url} alt="thumbnail" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-all" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      imageSearchQuery && <div className="text-center text-[9px] text-outline py-2">No images found. Try a different search term.</div>
                    )}
                  </div>
                )}

                {imageTab === 'url' && (
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="text"
                      placeholder="Image URL (https://...)"
                      value={imageWebUrl}
                      onChange={e => setImageWebUrl(e.target.value)}
                      className="w-full text-[10px] p-1.5 border border-outline-variant/20 rounded-lg bg-surface focus:outline-none focus:border-primary text-on-surface"
                    />
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        if (imageWebUrl && imageWebUrl !== 'https://') {
                          insertImageFormat(imageWebUrl);
                        }
                      }}
                      className="w-full py-1 bg-primary text-on-primary text-[10px] font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer"
                    >
                      Insert Web Image
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Formatting toolbar inside card */}
            <div className="flex items-center justify-between px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/5 rounded-b-xl relative z-10" onMouseDown={saveEditorRange}>
              <div className="flex items-center gap-1.5 text-outline">
                <button 
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); saveEditorRange(); }}
                  onClick={() => applyFormat('bold')} 
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    activeFormats.bold ? 'bg-primary/15 text-primary' : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
                  }`}
                  title="Bold"
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button 
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormat('italic')} 
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    activeFormats.italic ? 'bg-primary/15 text-primary' : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
                  }`}
                  title="Italic"
                >
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button 
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormat('insertUnorderedList')} 
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    activeFormats.bullet ? 'bg-primary/15 text-primary' : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
                  }`}
                  title="Bulleted List"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button 
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormat('insertOrderedList')} 
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    activeFormats.number ? 'bg-primary/15 text-primary' : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
                  }`}
                  title="Numbered List"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                </button>

                <span className="w-[1px] h-4 bg-outline-variant/30 mx-0.5" />
                <button 
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setLinkModalOpen(!linkModalOpen);
                    setImageModalOpen(false);
                  }} 
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    linkModalOpen ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
                  }`}
                  title="Add Link"
                >
                  <Link className="w-3.5 h-3.5" />
                </button>
                <button 
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setImageModalOpen(!imageModalOpen);
                    setLinkModalOpen(false);
                  }} 
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    imageModalOpen ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container-high text-outline hover:text-on-surface'
                  }`}
                  title="Add Image"
                >
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

          const sanitizePlayerData = (data) => {
            if (!data || typeof data !== 'object') return data;
            delete data.adPlacements;
            delete data.playerAds;
            delete data.adSlots;
            delete data.adBreakHeartbeatParams;
            if (data.playerConfig && data.playerConfig.adConfig) {
              delete data.playerConfig.adConfig;
            }
            return data;
          };

          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const res = await origFetch.apply(this, args);
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next')) {
              try {
                const clone = res.clone();
                let data = await clone.json();
                data = sanitizePlayerData(data);
                return new Response(JSON.stringify(data), {
                  status: res.status,
                  statusText: res.statusText,
                  headers: res.headers,
                });
              } catch (e) {}
            }
            return res;
          };

          const origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            if (typeof url === 'string' && (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next'))) {
              this.addEventListener('readystatechange', function() {
                if (this.readyState === 4 && this.status === 200) {
                  try {
                    let data = JSON.parse(this.responseText);
                    data = sanitizePlayerData(data);
                    Object.defineProperty(this, 'responseText', { value: JSON.stringify(data) });
                    Object.defineProperty(this, 'response', { value: JSON.stringify(data) });
                  } catch (e) {}
                }
              });
            }
            return origOpen.call(this, method, url, ...rest);
          };

          const skipAds = () => {
            const skipBtn = document.querySelector(
              '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button'
            );
            if (skipBtn) { skipBtn.click(); }

            const adBadge = document.querySelector(
              '.ytp-ad-simple-ad-badge, .ytp-ad-duration-remaining, .ytp-ad-text, .ad-showing, .ad-interrupting'
            );
            const v = document.querySelector('video');

            if (adBadge && v && !v.ended) {
              v.muted = true;
              v.playbackRate = 16.0;
              if (isFinite(v.duration) && v.duration > 0) {
                v.currentTime = v.duration - 0.1;
              }
            } else if (v && !adBadge && v.playbackRate === 16.0) {
              v.playbackRate = 1.0;
            }

            document.querySelectorAll(
              'tp-yt-iron-overlay-backdrop, ytd-popup-container, .ytp-ad-overlay-container, ytd-enforcement-message-view-model'
            ).forEach(el => el.style.display = 'none');
          };

          const obs = new MutationObserver(() => { skipAds(); });
          obs.observe(document.documentElement, { childList: true, subtree: true });
          setInterval(skipAds, 500);
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
  getFileSrc,
  onLinkClick,
}: {
  note: any;
  editingNoteId: string | null;
  editingNoteContent: string;
  setEditingNoteContent: (content: string) => void;
  startEditNote: (id: string, content: string) => void;
  confirmEditNote: (id: string, updatedContent: string) => void;
  cancelEditNote: () => void;
  deleteNote: (id: string) => void;
  setIsEditing: (val: boolean) => void;
  getFileSrc: (path: string | undefined | null) => string;
  onLinkClick?: (url: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isEditing = editingNoteId === note.id;
  const contentLimit = 250;
  const isLong = note.content.length > contentLimit || note.content.split('\n').length > 5;
  const cardEditorRef = useRef<HTMLDivElement>(null);

  const displayContent = isExpanded || !isLong
    ? note.content
    : note.content.slice(0, contentLimit).trim() + '...';

  const { renderedElements, tags } = parseRichText(displayContent, {
    getFileSrc,
    onLinkClick,
    openExternal: window.electronAPI ? window.electronAPI.openExternal : undefined,
  });

  useEffect(() => {
    if (isEditing && cardEditorRef.current) {
      cardEditorRef.current.innerHTML = markdownToHtml(note.content);
    }
  }, [isEditing, note.content]);

  const handleSave = () => {
    if (cardEditorRef.current) {
      const markdown = htmlToMarkdown(cardEditorRef.current.innerHTML);
      confirmEditNote(note.id, markdown);
    }
  };

  return (
    <div className="p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/15 group shadow-sm transition-all hover:shadow-md flex flex-col gap-2 relative">
      {isEditing ? (
        <div className="space-y-2">
          <div
            ref={cardEditorRef}
            contentEditable
            onFocus={() => setIsEditing(true)}
            onBlur={() => setIsEditing(false)}
            className="w-full min-h-[80px] bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-xs focus:outline-none overflow-y-auto text-on-surface"
            style={{ outline: 'none' }}
          />
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 cursor-pointer">Save</button>
            <button onClick={cancelEditNote} className="flex-1 py-1.5 bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg hover:bg-outline-variant/20 cursor-pointer">Cancel</button>
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



