import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StickyNote, Edit3, Trash2, BookOpen, ChevronRight, Bold, Italic, List, ListOrdered, Image, Link, SendHorizontal, X, Search, FileText, Eye, Loader2, Columns, Sigma } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMaterialNotes } from '../../hooks/useLocalData';
import { useActivityTimer } from '../../hooks/useActivityTimer';
import { Material } from '../../types';
import { useOverscroll } from '../../hooks/useOverscroll';
import { ipcService } from '../../services/ipcService';
import { htmlToMarkdown, markdownToHtml, parseRichText, searchWebImages } from '../../lib/editorUtils';
import { useTabs } from '../../hooks/useTabs';
import MarkdownRenderer from '../MarkdownRenderer';
import MathInsertModal from './MathInsertModal';

interface NoteEditorProps {
  data: Material;
  isActive?: boolean;
}

export default function NoteEditor({ data: material, isActive = true }: NoteEditorProps) {
  const { user } = useAuth();
  const { setTabs } = useTabs();
  const { notes, addNote, deleteNote, updateNote } = useMaterialNotes(material.id);
  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [isNotesCollapsed, setIsNotesCollapsed] = useState(false);

  // Standalone note editing & preview states
  const [mainNoteMode, setMainNoteMode] = useState<'edit' | 'preview' | 'split'>('preview');
  const [mainTitle, setMainTitle] = useState(material.title);
  const [mainContent, setMainContent] = useState(material.url || '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [mathModalOpen, setMathModalOpen] = useState(false);
  const mainSaveTimeoutRef = useRef<any>(null);
  const lastLoadedIdRef = useRef(material.id);

  // Sync internal states when active note tab changes.
  // We only reset title/content if the material.id actually changed (not on every re-render).
  // We do NOT re-fetch getAllMaterials here — that caused a race condition where a slow
  // DB read would overwrite the user's in-progress edits after they had already started typing.
  useEffect(() => {
    setMainTitle(material.title);
    setMainContent(material.url || '');
    
    if (lastLoadedIdRef.current !== material.id) {
      setMainNoteMode('preview');
      lastLoadedIdRef.current = material.id;
    }
    
    if (mainSaveTimeoutRef.current) clearTimeout(mainSaveTimeoutRef.current);
    setSaveStatus('idle');
  }, [material.id, material.title, material.url]);

  // Keyboard shortcut listener to toggle preview mode (Ctrl+P / Cmd+P)
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        // Always toggle between edit and preview (split is set manually via button only)
        setMainNoteMode(prev => prev === 'preview' ? 'edit' : 'preview');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  const triggerMainAutoSave = (updatedTitle: string, updatedContent: string) => {
    setSaveStatus('saving');
    if (mainSaveTimeoutRef.current) clearTimeout(mainSaveTimeoutRef.current);

    mainSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await ipcService.vault.updateMaterial(material.id, {
          title: updatedTitle.trim() || 'Untitled Note',
          url: updatedContent
        });
        
        // Update tabs state to sync title and tab data dynamically
        setTabs(prev => prev.map(t => t.id === `note-${material.id}` ? { 
          ...t, 
          title: updatedTitle,
          data: { ...t.data, title: updatedTitle, url: updatedContent }
        } : t));
        setSaveStatus('saved');
        // Auto-hide 'Saved' indicator after 2 seconds
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err) {
        console.error('[NoteEditor] Auto-save failed:', err);
        setSaveStatus('idle');
      }
    }, 800);
  };

  const handleMainTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    setMainTitle(nextTitle);
    triggerMainAutoSave(nextTitle, mainContent);
  };

  const handleMainContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextContent = e.target.value;
    setMainContent(nextContent);
    triggerMainAutoSave(mainTitle, nextContent);
  };

  const handleInsertMath = (mathCode: string) => {
    const nextContent = mainContent ? `${mainContent}\n${mathCode}` : mathCode;
    setMainContent(nextContent);
    triggerMainAutoSave(mainTitle, nextContent);
  };

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
        const parent = selection.getRangeAt(0).commonAncestorContainer;
        const editorEl = editorRef.current;
        if (editorEl && (editorEl === parent || editorEl.contains(parent))) {
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

  useEffect(() => {
    if (user && linkModalOpen) {
      ipcService.vault.getAllMaterials(user.id).then(setAllMaterials);
    }
  }, [user, linkModalOpen]);

  const filteredMaterials = allMaterials.filter(m => 
    m.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
  );

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

  const applyFormat = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    handleEditorInput();
    updateActiveFormats();
  };

  const insertLinkFormat = (type: 'material' | 'web', value: string, title?: string) => {
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

  const mainOverscrollRef = useOverscroll();
  const notesOverscrollRef = useOverscroll();

  // Well-being time tracking for notes
  useActivityTimer('Notes', isActive); // Active time spent studying/reviewing notes

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addNote(noteText.trim());
    setNoteText('');
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
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

  return (
    <div className="h-full flex bg-surface-container-lowest select-none">
      {/* Left Column: Note Text Body */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface relative h-full">
        {/* Quick Toolbar */}
        <div className="p-3 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low select-none shrink-0">
          <div className="flex items-center gap-2 truncate max-w-[50%]">
            <BookOpen className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-black text-primary truncate">{mainTitle || 'Untitled Note'}</span>
          </div>
          
          <div className="flex items-center gap-2.5 shrink-0 ui-invisible-border">
            {/* Auto-save Status Indicator */}
            {saveStatus === 'saving' ? (
              <span className="flex items-center gap-1 text-[9px] font-bold text-outline uppercase animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
                <span className="hidden sm:inline auto-symbol-label">Saving...</span>
              </span>
            ) : saveStatus === 'saved' ? (
              <span className="text-[9px] font-bold text-success flex items-center gap-1 uppercase">
                ✓ <span className="hidden sm:inline auto-symbol-label">Saved</span>
              </span>
            ) : null}
            
            {saveStatus !== 'idle' && <span className="w-[1px] h-3 bg-outline-variant/30" />}

            {/* Edit / Split / Preview Toggle */}
            <div className="flex bg-surface-container-lowest p-0.5 rounded-lg border border-outline-variant/25 shrink-0 select-none">
              <button
                onClick={() => setMainNoteMode('preview')}
                aria-label="Switch to Reading Mode"
                className={`py-1 px-2.5 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer focus:ring-2 focus:ring-primary/30 ${
                  mainNoteMode === 'preview' 
                    ? 'bg-primary text-on-primary shadow-sm' 
                    : 'text-on-surface hover:text-primary'
                }`}
                title="Switch to Reading Mode (Obsidian Live Render)"
              >
                <Eye className="w-3.5 h-3.5" /> <span className="hidden sm:inline auto-symbol-label">Reading</span>
              </button>
              <button
                onClick={() => setMainNoteMode('split')}
                aria-label="Switch to Split View"
                className={`py-1 px-2.5 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer focus:ring-2 focus:ring-primary/30 ${
                  mainNoteMode === 'split' 
                    ? 'bg-primary text-on-primary shadow-sm' 
                    : 'text-on-surface hover:text-primary'
                }`}
                title="Switch to Split View (IDE Side-by-Side)"
              >
                <Columns className="w-3.5 h-3.5" /> <span className="hidden sm:inline auto-symbol-label">Split</span>
              </button>
              <button
                onClick={() => setMainNoteMode('edit')}
                aria-label="Switch to Edit Mode"
                className={`py-1 px-2.5 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer focus:ring-2 focus:ring-primary/30 ${
                  mainNoteMode === 'edit' 
                    ? 'bg-primary text-on-primary shadow-sm' 
                    : 'text-on-surface hover:text-primary'
                }`}
                title="Switch to Edit Mode"
              >
                <Edit3 className="w-3.5 h-3.5" /> <span className="hidden sm:inline auto-symbol-label">Edit</span>
              </button>
            </div>
            
            <span className="w-[1px] h-3 bg-outline-variant/30" />

            <button
              onClick={() => setIsNotesCollapsed(!isNotesCollapsed)}
              aria-label={isNotesCollapsed ? "Show Notes Panel" : "Hide Notes Panel"}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 cursor-pointer focus:ring-2 focus:ring-primary/30 ${
                isNotesCollapsed 
                  ? 'bg-primary text-on-primary shadow-sm hover:scale-[1.02]' 
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title={isNotesCollapsed ? "Show Notes" : "Hide Notes"}
            >
              <StickyNote className="w-3 h-3" />
              <span className="hidden sm:inline auto-symbol-label">{isNotesCollapsed ? 'Show Notes' : 'Hide Notes'}</span>
            </button>
          </div>
        </div>
        
        {/* Body content */}
        {/* Shared title input for both edit and split modes — extracted to avoid duplication */}
        {mainNoteMode !== 'preview' && (
          <input
            type="text"
            placeholder="Untitled Note"
            value={mainTitle}
            onChange={handleMainTitleChange}
            className="w-full text-3xl font-extrabold font-headline tracking-tight text-on-surface bg-transparent focus:outline-none border-b border-transparent focus:border-outline-variant/30 pb-2 transition-all px-8 md:px-12 pt-8 shrink-0"
          />
        )}
        <div ref={mainOverscrollRef} className={`flex-1 overflow-y-auto p-8 md:p-12 mx-auto w-full flex flex-col gap-6 select-text selection:bg-on-primary-container/20 h-full ${mainNoteMode === 'split' ? 'max-w-7xl' : 'max-w-3xl'}`}>
          {mainNoteMode === 'split' ? (
            <div className="flex flex-col gap-4 flex-1 h-full overflow-hidden">
              {/* Title is rendered above this scroll container — see the shared title input above */}
              <div className="flex-1 flex gap-6 min-h-[400px] overflow-hidden">
                {/* Left: Textarea Editor */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  <div className="text-[10px] text-outline font-bold uppercase select-none flex justify-between items-center">
                    <span>Editor (Markdown Source)</span>
                    <span>{mainContent.length} characters</span>
                  </div>
                  <textarea
                    placeholder="Write your note in Markdown... Use ```mermaid for diagrams."
                    value={mainContent}
                    onChange={handleMainContentChange}
                    className="w-full flex-1 resize-none text-sm text-on-surface leading-relaxed outline-none font-mono bg-transparent border border-outline-variant/10 rounded-xl p-4 focus:border-primary/35 focus:ring-1 focus:ring-primary/20 transition-all overflow-y-auto"
                    style={{ outline: 'none' }}
                  />
                </div>
                {/* Right: Live Preview */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  <div className="text-[10px] text-outline font-bold uppercase select-none">
                    <span>Live Preview</span>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1">
                    <MarkdownRenderer 
                      content={mainContent || '*No content yet. Start writing...*'} 
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : mainNoteMode === 'edit' ? (
            <div className="flex flex-col gap-4 flex-1 h-full">
              
              <div className="text-[10px] text-outline font-bold uppercase flex justify-between items-center -mt-3 select-none">
                <span>{mainContent.length} characters</span>
                {mainContent.length > 20000 && (
                  <span className="text-amber-500 font-extrabold flex items-center gap-1 animate-pulse">
                    ⚠️ Large Note. Splitting recommended to avoid performance lag.
                  </span>
                )}
              </div>

              {/* Markdown content textarea */}
              <textarea
                placeholder="Write your note in Markdown... Use ```mermaid for diagrams."
                value={mainContent}
                onChange={handleMainContentChange}
                className="w-full flex-1 min-h-[400px] resize-none text-sm text-on-surface leading-relaxed outline-none font-mono bg-transparent border border-outline-variant/10 rounded-xl p-4 focus:border-primary/35 focus:ring-1 focus:ring-primary/20 transition-all overflow-y-auto"
                style={{ outline: 'none' }}
              />
            </div>
          ) : (
            // Preview mode: MarkdownRenderer handles ALL content including the title heading.
            // Do NOT render a separate hardcoded <h1> here — that causes double-heading.
            <div className="flex flex-col gap-4 flex-1">
              {mainContent.length > 20000 && (
                <span className="text-amber-500 font-extrabold text-[10px] flex items-center gap-1 animate-pulse select-none">
                  ⚠️ Note is very large ({mainContent.length} chars). Editor lag may occur.
                </span>
              )}
              <MarkdownRenderer 
                content={mainContent || `# ${mainTitle || 'Untitled Note'}\n\n*No content yet. Click Edit to write something.*`} 
                className="flex-1"
              />
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Notes Panel — no absolute-positioned children */}
      <div className={`flex flex-col shrink-0 h-full border-l border-outline-variant/10 bg-surface-container-low transition-[width,opacity] duration-300 ease-in-out ${
        isNotesCollapsed ? 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none' : 'w-72 opacity-100'
      }`}>
        <div className="w-72 h-full flex flex-col">
          {/* Panel header */}
        <div className="p-3.5 border-b border-outline-variant/10 flex items-center justify-between shrink-0 select-none">
          <h4 className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2 text-on-surface font-headline font-semibold">
            <StickyNote className="w-3.5 h-3.5 text-primary" />
            Annotated Links
          </h4>
          <div className="flex items-center gap-1 text-outline">
            <button
              onClick={() => setIsNotesCollapsed(true)}
              className="p-1 hover:bg-surface-container-high text-outline hover:text-on-surface rounded-lg transition-colors"
              title="Collapse Sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-notes list */}
        <div ref={notesOverscrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5 no-scrollbar">
          {notes.length === 0 && (
            <p className="text-[10px] text-outline italic p-2">No sub-notes logged yet. Write below.</p>
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
              getFileSrc={getFileSrc}
              onLinkClick={handleLinkClick}
            />
          ))}
        </div>

        {/* Input box */}
        <div className="p-3 border-t border-outline-variant/10 shrink-0 bg-surface-container-low relative">
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all relative">
            <div
              ref={editorRef}
              contentEditable
              onInput={handleEditorInput}
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

            {/* Toolbar Footer inside Card */}
            <div className="flex items-center justify-between px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/5 rounded-b-xl relative z-10">
              {/* Formatter Buttons */}
              <div className="flex items-center gap-1.5 text-outline">
                <button 
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
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

              {/* Submit button */}
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

      <MathInsertModal 
        isOpen={mathModalOpen}
        onClose={() => setMathModalOpen(false)}
        onInsert={handleInsertMath}
      />
    </div>
  );
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
    <div className="p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/15 group shadow-sm transition-all hover:shadow-md flex flex-col gap-2 relative text-left">
      {isEditing ? (
        <div className="space-y-2">
          <div
            ref={cardEditorRef}
            contentEditable
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


