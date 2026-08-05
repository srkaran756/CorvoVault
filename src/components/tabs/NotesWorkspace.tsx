import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  StickyNote, Folder, FolderPlus, Plus, Search, Trash2, Edit3, 
  Bold, Italic, Underline, Strikethrough, Highlighter, 
  List, ListOrdered, Link, Image, Undo, Redo, Eye, X, 
  FileText, ChevronDown, ChevronRight, Type, Sparkles, Loader2, Columns, Sigma
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { ipcService } from '../../services/ipcService';
import { Material } from '../../types';
import { htmlToMarkdown, markdownToHtml, searchWebImages } from '../../lib/editorUtils';
import MarkdownRenderer from '../MarkdownRenderer';
import MathInsertModal from './MathInsertModal';

interface NotesWorkspaceProps {
  isActive: boolean;
}

export default function NotesWorkspace({ isActive }: NotesWorkspaceProps) {
  const { user } = useAuth();
  const profileId = user?.id || '';

  // Data states
  const [notes, setNotes] = useState<Material[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  
  // Navigation & filter states
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Editor states
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>('preview');
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteHtml, setNoteHtml] = useState<string>('');
  // noteMarkdown is the live canonical markdown — updated on every keystroke so
  // split-view and preview always reflect the latest content without waiting for the
  // 800ms DB auto-save flush. Initialized from activeNote.url (the stored markdown).
  const [noteMarkdown, setNoteMarkdown] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [mathModalOpen, setMathModalOpen] = useState(false);

  // Link & Image Modal states
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkTab, setLinkTab] = useState<'material' | 'web'>('material');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkDisplayName, setLinkDisplayName] = useState('');
  const [linkWebUrl, setLinkWebUrl] = useState('https://');
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);

  // NOTE: allMaterials is already populated by loadData() on mount and on real-time events.
  // No separate fetch is needed when the link modal opens.

  const filteredMaterials = useMemo(() => {
    return allMaterials.filter(m =>
      m.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
    );
  }, [allMaterials, linkSearchQuery]);

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

  // Active styles formatting indicators
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    highlight: false,
    bullet: false,
    number: false,
    h1: false,
    h2: false,
    h3: false,
    serif: false,
    monospace: false
  });

  const editorRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<any>(null);
  const savedRangeRef = useRef<Range | null>(null);

  // Selected note object derived from notes list
  const activeNote = useMemo(() => {
    return notes.find(n => n.id === selectedNoteId) || null;
  }, [notes, selectedNoteId]);

  // Load all folders, topics, and notes
  const loadData = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      // Get topics to locate "Course Vault"
      const tList = await ipcService.topics.getAll(profileId);
      setTopics(tList || []);

      // Get all folders
      const fList = await ipcService.folders.getAllByProfile(profileId);
      setFolders(fList || []);

      // Get all materials and filter by notes (boxType === 'note')
      const mList = await ipcService.vault.getAllMaterials(profileId);
      const filteredNotes = (mList || []).filter((m: Material) => m.boxType === 'note' && m.storageStatus !== 'trashed');
      setNotes(filteredNotes);
      
      // Load all materials for the link dialog search list
      setAllMaterials(mList || []);
    } catch (e) {
      console.error('[NotesWorkspace] Failed to load workspace data:', e);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Subscribe to real-time events to refresh note list
  useEffect(() => {
    if (!window.electronAPI) return;
    const reload = () => loadData();
    const unsubList = [
      window.electronAPI.on('material:created', reload),
      window.electronAPI.on('material:updated', reload),
      window.electronAPI.on('material:deleted', reload),
      window.electronAPI.on('material:trashed', reload),
      window.electronAPI.on('material:restored', reload)
    ];
    return () => {
      unsubList.forEach(off => off && off());
    };
  }, [loadData]);

  // Load active note details into editor state when note ID changes
  useEffect(() => {
    if (activeNote) {
      setNoteTitle(activeNote.title);
      // Main note body content is stored in URL column as clean Markdown.
      // We fall back to HTML or convert standard Markdown to HTML.
      const content = activeNote.url || '';
      const contentHtml = (content.includes('<p>') || content.includes('<div>') || content.includes('<br>') || content.includes('<li>') || content.includes('<h1>') || content.includes('<h2>') || content.includes('<h3>'))
        ? content // Legacy HTML format
        : markdownToHtml(content); // Markdown format normalized to HTML for visual editor

      setNoteHtml(contentHtml);
      setNoteMarkdown(content); // Keep live markdown in sync from DB source
      if (editorRef.current && editorMode === 'edit') {
        editorRef.current.innerHTML = contentHtml;
      }
    } else {
      setNoteTitle('');
      setNoteHtml('');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
    }
    // Cancel any pending saves
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setIsSaving(false);
  }, [selectedNoteId]);

  // Sync the contentEditable DOM ONLY when the user switches INTO edit/split mode.
  // Intentionally NOT including noteHtml in deps — that would reset the DOM (and the cursor)
  // on every keystroke, causing the dreaded caret-jump bug while typing.
  const prevEditorModeRef = useRef(editorMode);
  useEffect(() => {
    const prevMode = prevEditorModeRef.current;
    prevEditorModeRef.current = editorMode;
    // Only re-sync innerHTML when we are transitioning INTO edit/split from a different mode
    if (
      (editorMode === 'edit' || editorMode === 'split') &&
      (prevMode === 'preview') &&
      editorRef.current
    ) {
      editorRef.current.innerHTML = noteHtml;
    }
  }, [editorMode]);

  // Keyboard shortcut listener to toggle preview mode (Ctrl+P / Cmd+P)
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setEditorMode(prev => prev === 'edit' ? 'preview' : 'edit');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  // Maintain text styling check
  const updateActiveFormats = () => {
    if (editorMode !== 'edit') return;
    
    // Check heading styles
    let h1 = false, h2 = false, h3 = false;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      let parent: Node | null = selection.getRangeAt(0).commonAncestorContainer;
      while (parent && parent !== editorRef.current) {
        if (parent.nodeName === 'H1') h1 = true;
        if (parent.nodeName === 'H2') h2 = true;
        if (parent.nodeName === 'H3') h3 = true;
        parent = parent.parentNode;
      }
    }

    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
      highlight: document.queryCommandState('backColor') && document.queryCommandValue('backColor') !== 'transparent',
      bullet: document.queryCommandState('insertUnorderedList'),
      number: document.queryCommandState('insertOrderedList'),
      h1,
      h2,
      h3,
      serif: document.queryCommandValue('fontName')?.toLowerCase().includes('serif') || false,
      monospace: document.queryCommandValue('fontName')?.toLowerCase().includes('monospace') || false
    });
  };

  // Sync cursor selection inside visual editor to prevent focus loss issues
  const saveEditorRange = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const parent = range.commonAncestorContainer;
      const editorEl = editorRef.current;
      if (editorEl && (editorEl === parent || editorEl.contains(parent))) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  };

  const restoreEditorRange = () => {
    if (savedRangeRef.current && editorRef.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRangeRef.current);
    }
  };

  // Track selection change inside visual editor
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
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [editorMode]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Debounced auto-save function (saves raw Markdown directly to DB)
  const triggerAutoSave = (updatedTitle: string, updatedMarkdown: string) => {
    if (!selectedNoteId) return;
    setIsSaving(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await ipcService.vault.updateMaterial(selectedNoteId, {
          title: updatedTitle.trim() || 'Untitled Note',
          url: updatedMarkdown
        });
        
        // Quietly update local notes cache title and markdown content
        setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title: updatedTitle, url: updatedMarkdown } : n));
      } catch (err) {
        console.error('[NotesWorkspace] Auto-save failed:', err);
      } finally {
        setIsSaving(false);
      }
    }, 600);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setNoteTitle(newTitle);
    triggerAutoSave(newTitle, noteMarkdown);
  };

  const handleMarkdownChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextMarkdown = e.target.value;
    setNoteMarkdown(nextMarkdown);
    triggerAutoSave(noteTitle, nextMarkdown);
  };

  const insertMarkdownText = (textToInsert: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      const next = (noteMarkdown ? noteMarkdown + '\n\n' : '') + textToInsert;
      setNoteMarkdown(next);
      triggerAutoSave(noteTitle, next);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = noteMarkdown.substring(0, start) + textToInsert + noteMarkdown.substring(end);
    setNoteMarkdown(next);
    triggerAutoSave(noteTitle, next);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
    }, 0);
  };

  // Apply Markdown Formatting directly to selected text in Markdown editor
  const applyMarkdownFormat = (type: 'bold' | 'italic' | 'list' | 'link' | 'image') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = noteMarkdown.substring(start, end);
    let replacement = '';

    switch (type) {
      case 'bold':
        replacement = `**${selectedText || 'bold text'}**`;
        break;
      case 'italic':
        replacement = `*${selectedText || 'italic text'}*`;
        break;
      case 'list':
        replacement = selectedText
          ? selectedText.split('\n').map(line => `- ${line}`).join('\n')
          : `- List item`;
        break;
      case 'link':
        replacement = `[${selectedText || linkDisplayName || 'Link'}](https://)`;
        break;
      case 'image':
        replacement = `![${selectedText || 'Image'}](https://)`;
        break;
    }

    const next = noteMarkdown.substring(0, start) + replacement + noteMarkdown.substring(end);
    setNoteMarkdown(next);
    triggerAutoSave(noteTitle, next);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 0);
  };

  // Note actions
  const handleCreateNote = async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      // 1. Ensure "Course Vault" Topic exists
      const topicName = 'Course Vault';
      let topic = topics.find(t => t.name === topicName);
      let topicId = topic?.id;
      if (!topicId) {
        topicId = crypto.randomUUID();
        await ipcService.topics.create(profileId, topicName);
        // Refresh topics list
        const updatedT = await ipcService.topics.getAll(profileId);
        setTopics(updatedT || []);
        const newTopicObj = updatedT.find(t => t.name === topicName);
        if (newTopicObj) topicId = newTopicObj.id;
      }

      // 2. Select folder ID: Use chosen sidebar folder, or default "My Notes"
      let folderId = selectedFolderId !== 'all' ? selectedFolderId : '';
      if (!folderId) {
        const defaultFolderName = 'My Notes';
        let defaultFolder = folders.find(f => f.name === defaultFolderName && f.topicId === topicId);
        if (!defaultFolder) {
          if (topicId) {
            await ipcService.folders.create(topicId, profileId, defaultFolderName);
            const updatedF = await ipcService.folders.getAllByProfile(profileId);
            setFolders(updatedF || []);
            defaultFolder = updatedF.find(f => f.name === defaultFolderName && f.topicId === topicId);
          }
        }
        folderId = defaultFolder?.id || '';
      }

      if (!folderId) {
        throw new Error('Failed to resolve target folder for note');
      }

      // 3. Create Note Material (with empty string, standardizing to markdown format)
      const noteData = {
        folderId,
        profileId,
        boxType: 'note',
        title: 'Untitled Note',
        url: ''
      };

      const result = await ipcService.vault.capture('note', noteData);
      if (result) {
        setNotes(prev => [result, ...prev]);
        setSelectedNoteId(result.id);
        setEditorMode('edit');
        setTimeout(() => {
          titleInputRef.current?.focus();
          titleInputRef.current?.select();
        }, 150);
      }
    } catch (err) {
      console.error('[NotesWorkspace] Failed to create note:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async (id: string) => {
    if (!confirm('Are you sure you want to trash this note?')) return;
    try {
      await ipcService.vault.trashMaterial(id, profileId);
      setNotes(prev => prev.filter(n => n.id !== id));
      if (selectedNoteId === id) {
        setSelectedNoteId(null);
      }
    } catch (err) {
      console.error('[NotesWorkspace] Failed to delete note:', err);
    }
  };

  // Create Folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !profileId) return;
    try {
      const topicName = 'Course Vault';
      let topic = topics.find(t => t.name === topicName);
      let topicId = topic?.id;
      if (!topicId) {
        topicId = crypto.randomUUID();
        await ipcService.topics.create(profileId, topicName);
        const updatedT = await ipcService.topics.getAll(profileId);
        setTopics(updatedT || []);
        topicId = updatedT.find(t => t.name === topicName)?.id;
      }

      if (topicId) {
        await ipcService.folders.create(topicId, profileId, newFolderName.trim());
        const updatedF = await ipcService.folders.getAllByProfile(profileId);
        setFolders(updatedF || []);
        setSelectedFolderId(updatedF.find(f => f.name === newFolderName.trim() && f.topicId === topicId)?.id || 'all');
      }

      setNewFolderName('');
      setShowFolderModal(false);
    } catch (err) {
      console.error('[NotesWorkspace] Failed to create folder:', err);
    }
  };

  // Image insertion
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
      
      const fileUrl = window.electronAPI.platform === 'win32'
        ? `corvovault-file:///${localData.localPath.replace(/\\/g, '/')}`
        : `corvovault-file://${localData.localPath}`;
      
      insertMarkdownText(`![Image](${fileUrl})`);
      setImageModalOpen(false);
    } catch (err: any) {
      alert(`Failed to import image: ${err.message}`);
    }
  };

  const insertImageFormat = (url: string) => {
    insertMarkdownText(`![Image](${url})`);
    setImageModalOpen(false);
  };

  // Link Insertion
  const insertLinkFormat = (type: 'material' | 'web', value: string, title?: string) => {
    if (type === 'material') {
      const url = `corvovault-material://${value}`;
      const text = title || 'Linked Material';
      insertMarkdownText(`[${text}](${url})`);
    } else {
      const text = linkDisplayName || value;
      insertMarkdownText(`[${text}](${value})`);
    }
    setLinkModalOpen(false);
    setLinkSearchQuery('');
    setLinkDisplayName('');
    setLinkWebUrl('https://');
  };

  // Handle clicking link inside preview/editor
  const handleLinkClick = (url: string) => {
    if (url.startsWith('corvovault-material://')) {
      const targetId = url.replace('corvovault-material://', '');
      const targetNote = notes.find(n => n.id === targetId);
      if (targetNote) {
        setSelectedNoteId(targetId);
      } else {
        const material = allMaterials.find(m => m.id === targetId);
        if (material) {
          const type = material.boxType === 'note' ? 'note' : 'document';
          window.dispatchEvent(new CustomEvent('corvovault:switch-tab', {
            detail: { tab: { type, title: material.title, data: material } }
          }));
        } else {
          alert('Linked material not found in Library.');
        }
      }
    }
  };

  /**
   * Strip both HTML tags AND Markdown syntax from note content to produce
   * clean plain-text snippets for the sidebar list and accurate word/char counts.
   */
  const stripMarkdown = (text: string) => {
    if (!text) return '';
    return text
      .replace(/<[^>]*>/g, ' ')                  // strip HTML tags
      .replace(/^#{1,6}\s+/gm, '')               // ## headings
      .replace(/\*\*([^*]+)\*\*/g, '$1')         // **bold**
      .replace(/\*([^*]+)\*/g, '$1')             // *italic*
      .replace(/_{2}([^_]+)_{2}/g, '$1')         // __bold__
      .replace(/_([^_]+)_/g, '$1')               // _italic_
      .replace(/~~([^~]+)~~/g, '$1')             // ~~strike~~
      .replace(/`{3}[\s\S]*?`{3}/g, '')          // ```code blocks```
      .replace(/`([^`]+)`/g, '$1')               // `inline code`
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // [links](url)
      .replace(/^[-*+]\s+/gm, '')               // - bullet lists
      .replace(/^\d+\.\s+/gm, '')               // 1. numbered lists
      .replace(/^>\s*/gm, '')                    // > blockquotes
      .replace(/^---+$/gm, '')                   // --- horizontal rules
      .replace(/[|]/g, ' ')                      // table pipes
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Real-time Word & Character count stats helper
  const stats = useMemo(() => {
    const rawContent = noteMarkdown || noteHtml || '';
    const cleanText = stripMarkdown(rawContent);
    const wordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
    const charCount = cleanText.length;
    return { words: wordCount, chars: charCount };
  }, [noteMarkdown, noteHtml]);

  // Bi-directional backlinks parser
  const backlinks = useMemo(() => {
    if (!selectedNoteId) return [];
    return notes.filter(n => n.id !== selectedNoteId && n.url?.includes(`corvovault-material://${selectedNoteId}`));
  }, [notes, selectedNoteId]);

  // Filters notes based on folder selection and search query
  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      const matchesFolder = selectedFolderId === 'all' || n.folderId === selectedFolderId;
      const cleanTitle = n.title.toLowerCase();
      const cleanText = stripMarkdown(n.url || '').toLowerCase();
      const matchesSearch = cleanTitle.includes(searchQuery.toLowerCase()) || cleanText.includes(searchQuery.toLowerCase());
      return matchesFolder && matchesSearch;
    });
  }, [notes, selectedFolderId, searchQuery]);

  return (
    <div className="h-full flex bg-surface overflow-hidden font-body select-none">
      
      {/* ── Left Sidebar (Notes Vault List) ─────────────────────────────────── */}
      <div className="w-64 border-r border-outline-variant/10 bg-surface-container-low flex flex-col shrink-0">
        
        {/* Sidebar Header */}
        <div className="p-4 border-b border-outline-variant/10 flex items-center justify-between select-none">
          <div className="flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-sm font-headline tracking-tight text-on-surface">Notes Vault</h3>
          </div>
          <div className="flex gap-1">
            <button 
              onClick={() => setShowFolderModal(true)}
              className="p-1.5 hover:bg-surface-container-high rounded-lg text-outline hover:text-on-surface transition-colors cursor-pointer"
              title="New Folder"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
            <button 
              onClick={handleCreateNote}
              className="p-1.5 bg-primary text-on-primary rounded-lg hover:opacity-90 shadow-sm transition-all flex items-center justify-center cursor-pointer"
              title="New Note"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Folder Navigator selector */}
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Folder className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-outline/70" />
            <select
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              className="w-full bg-surface-container-lowest rounded-lg py-2 pl-8 pr-3 text-[11px] font-bold border border-outline-variant/20 focus:outline-none focus:border-primary text-on-surface appearance-none cursor-pointer"
            >
              <option value="all">📂 All Folders</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>📁 {f.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-outline pointer-events-none" />
          </div>
        </div>

        {/* Search Notes bar */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-outline/70" />
            <input
              type="text"
              placeholder="Search note titles & contents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-container-lowest rounded-lg py-2 pl-8 pr-3 text-xs font-semibold border border-outline-variant/20 focus:outline-none focus:border-primary text-on-surface placeholder:text-outline/50"
            />
          </div>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1 no-scrollbar">
          {loading && notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-outline">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-[10px] uppercase font-bold tracking-widest">Loading notes...</span>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center py-12 px-4 text-outline italic text-[11px]">
              No notes found.
            </div>
          ) : (
            filteredNotes.map((note) => {
              const active = note.id === selectedNoteId;
              const textSnippet = stripMarkdown(note.url || '');
              return (
                <div 
                  key={note.id}
                  onClick={() => setSelectedNoteId(note.id)}
                  className={`p-3 rounded-xl transition-all cursor-pointer relative group flex flex-col gap-1 border border-transparent hover:border-outline-variant/10 ${
                    active 
                      ? 'bg-primary/5 text-primary border-primary/20 shadow-sm' 
                      : 'bg-transparent text-on-surface hover:bg-surface-container-high/40'
                  }`}
                >
                  {active && (
                    <div className="absolute left-0 top-3 bottom-3 w-0.5 bg-primary rounded-r-md"></div>
                  )}

                  <div className="flex justify-between items-start gap-1">
                    <span className="text-xs font-bold font-headline truncate pr-4">{note.title || 'Untitled Note'}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNote(note.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 rounded transition-all shrink-0 cursor-pointer"
                      title="Trash Note"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-outline/65 hover:text-red-500" />
                    </button>
                  </div>
                  
                  {textSnippet ? (
                    <span className="text-[10px] text-outline line-clamp-2 leading-tight">
                      {textSnippet}
                    </span>
                  ) : (
                    <span className="text-[10px] text-outline/40 italic">Empty note</span>
                  )}
                  
                  <span className="text-[8px] text-outline/60 mt-1 uppercase font-semibold">
                    {new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Workspace (Note Editor panel) ─────────────────────────────── */}
      <div className="flex-1 bg-surface flex flex-col min-w-0 overflow-hidden relative">
        
        <AnimatePresence mode="wait">
          {!selectedNoteId ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex-1 flex flex-col items-center justify-center text-outline gap-4 select-none p-8"
            >
              <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center shadow-inner relative text-primary/30">
                <StickyNote className="w-8 h-8 text-primary animate-pulse" />
                <Sparkles className="w-4 h-4 text-accent absolute top-1.5 right-1.5 animate-bounce" />
              </div>
              <div className="text-center space-y-1.5">
                <h4 className="font-extrabold text-sm font-headline tracking-tight text-on-surface">Notes Studio</h4>
                <p className="text-[11px] max-w-xs leading-normal">
                  Create a new note or select an existing document from the sidebar to start styling and writing.
                </p>
              </div>
              <button
                onClick={handleCreateNote}
                className="bg-primary text-on-primary py-2.5 px-6 rounded-xl text-xs font-bold hover:scale-[1.02] active:scale-95 shadow-md hover:opacity-90 flex items-center gap-2 cursor-pointer transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Create New Note
              </button>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col min-w-0 overflow-hidden h-full"
            >
              {/* Consolidated Slim Tool Ribbon */}
              <div className="px-6 py-2.5 border-b border-outline-variant/10 bg-surface-container-low flex items-center justify-between shrink-0 select-none">
                {/* Left: Note Title, Folder Badge & Auto-Save Status */}
                <div className="flex items-center gap-3 min-w-0">
                  <StickyNote className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-xs font-bold font-headline text-on-surface truncate max-w-[220px]">
                    {noteTitle || 'Untitled Note'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-outline font-semibold uppercase tracking-wider shrink-0 hidden sm:inline-block">
                    {folders.find(f => f.id === activeNote?.folderId)?.name || 'Course Vault'}
                  </span>
                  {isSaving ? (
                    <span className="text-[9px] font-bold text-outline flex items-center gap-1 uppercase tracking-wider shrink-0 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin text-primary" /> Saving...
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold text-success flex items-center gap-1 uppercase tracking-wider shrink-0">
                      ✓ Saved
                    </span>
                  )}
                </div>

                {/* Right: Quick Tools (in Edit/Split) & View Mode Switcher */}
                <div className="flex items-center gap-3 shrink-0">
                  {(editorMode === 'edit' || editorMode === 'split') && (
                    <div className="hidden lg:flex items-center gap-1 pr-3 border-r border-outline-variant/15">
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyMarkdownFormat('bold')}
                        className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant cursor-pointer"
                        title="Bold"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyMarkdownFormat('italic')}
                        className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant cursor-pointer"
                        title="Italic"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyMarkdownFormat('list')}
                        className="p-1.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant cursor-pointer"
                        title="Bulleted List"
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setLinkModalOpen(true)}
                        className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors cursor-pointer"
                        title="Insert Link"
                      >
                        <Link className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setImageModalOpen(true)}
                        className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors cursor-pointer"
                        title="Insert Image"
                      >
                        <Image className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* View Mode Switcher (Obsidian Reading / IDE Split Preview / Source Edit) */}
                  <div className="flex items-center gap-2">
                    <div className="flex bg-surface-container-lowest p-0.5 rounded-lg border border-outline-variant/25">
                      <button
                        onClick={() => setEditorMode('preview')}
                        className={`py-1 px-3 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                          editorMode === 'preview' 
                            ? 'bg-primary text-on-primary shadow-sm' 
                            : 'text-on-surface hover:text-primary'
                        }`}
                        title="Live Rendered View (Obsidian style)"
                      >
                        <Eye className="w-3.5 h-3.5" /> Reading
                      </button>
                      <button
                        onClick={() => setEditorMode('split')}
                        className={`py-1 px-3 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                          editorMode === 'split' 
                            ? 'bg-primary text-on-primary shadow-sm' 
                            : 'text-on-surface hover:text-primary'
                        }`}
                        title="Split View (IDE style side-by-side preview)"
                      >
                        <Columns className="w-3.5 h-3.5" /> Split
                      </button>
                      <button
                        onClick={() => setEditorMode('edit')}
                        className={`py-1 px-3 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                          editorMode === 'edit' 
                            ? 'bg-primary text-on-primary shadow-sm' 
                            : 'text-on-surface hover:text-primary'
                        }`}
                        title="Source Edit Mode"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                    </div>

                    <button
                      onClick={() => setMathModalOpen(true)}
                      className="py-1 px-2.5 text-[11px] font-bold rounded-md text-on-surface hover:text-primary bg-surface-container-lowest hover:bg-surface-container-high transition-all flex items-center gap-1.5 cursor-pointer border border-outline-variant/25 shrink-0 shadow-2xs"
                      title="Insert Math / TeX Formula"
                    >
                      <Sigma className="w-3.5 h-3.5 text-primary" /> Math
                    </button>
                  </div>
                </div>
              </div>


              <div className="flex-1 overflow-y-auto flex flex-col relative bg-surface select-text select-none-parent">
                <div className={`flex-1 mx-auto w-full p-8 md:p-12 flex flex-col gap-6 ${editorMode === 'split' ? 'max-w-7xl' : 'max-w-3xl'}`}>
                  <input
                    ref={titleInputRef}
                    type="text"
                    placeholder="Untitled Note"
                    value={noteTitle}
                    onChange={handleTitleChange}
                    className="w-full text-3xl font-extrabold font-headline tracking-tight text-on-surface bg-transparent focus:outline-none border-b-2 border-transparent focus:border-outline-variant/35 pb-2 transition-all"
                  />

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-outline font-bold uppercase select-none border-b border-outline-variant/5 pb-3">
                    <span className="flex items-center gap-1">
                      <Folder className="w-3 h-3" />
                      {folders.find(f => f.id === activeNote?.folderId)?.name || 'Course Vault'}
                    </span>
                    <span>·</span>
                    <span>{stats.words} words</span>
                    <span>·</span>
                    <span>{stats.chars} chars</span>
                    {activeNote?.createdAt && (
                      <>
                        <span>·</span>
                        <span>Created {new Date(activeNote.createdAt).toLocaleDateString()}</span>
                      </>
                    )}
                    {stats.chars > 20000 && (
                      <>
                        <span>·</span>
                        <span className="text-amber-500 font-extrabold flex items-center gap-1 animate-pulse select-none">
                          ⚠️ Large Note (performance warning)
                        </span>
                      </>
                    )}
                  </div>

                  {editorMode === 'split' ? (
                    <div className="flex-1 flex gap-6 min-h-[400px] overflow-hidden">
                      {/* Left: Markdown Source Editor */}
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        <div className="text-[10px] text-outline font-bold uppercase select-none flex justify-between items-center">
                          <span>Markdown Source</span>
                          <span>{stats.chars} chars</span>
                        </div>
                        <textarea
                          ref={textareaRef}
                          placeholder="Write your note in Markdown... Use ```mermaid for diagrams."
                          value={noteMarkdown}
                          onChange={handleMarkdownChange}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              const start = e.currentTarget.selectionStart;
                              const end = e.currentTarget.selectionEnd;
                              const next = noteMarkdown.substring(0, start) + '  ' + noteMarkdown.substring(end);
                              setNoteMarkdown(next);
                              triggerAutoSave(noteTitle, next);
                              setTimeout(() => {
                                if (textareaRef.current) {
                                  textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
                                }
                              }, 0);
                            }
                          }}
                          className="w-full flex-1 min-h-[400px] resize-none text-sm text-on-surface leading-relaxed outline-none font-mono bg-transparent border border-outline-variant/10 rounded-xl p-4 focus:border-primary/35 focus:ring-1 focus:ring-primary/20 transition-all overflow-y-auto"
                          style={{ outline: 'none' }}
                        />
                      </div>
                      {/* Right: Live Rendered Preview */}
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        <div className="text-[10px] text-outline font-bold uppercase select-none">
                          <span>Live Rendered Preview</span>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-1">
                          <MarkdownRenderer 
                            content={noteMarkdown || '*No content yet. Start writing...*'} 
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  ) : editorMode === 'edit' ? (
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="text-[10px] text-outline font-bold uppercase select-none flex justify-between items-center">
                        <span>Markdown Source</span>
                        <span>{stats.chars} chars</span>
                      </div>
                      <textarea
                        ref={textareaRef}
                        placeholder="Write your note in Markdown... Use ```mermaid for diagrams."
                        value={noteMarkdown}
                        onChange={handleMarkdownChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            const start = e.currentTarget.selectionStart;
                            const end = e.currentTarget.selectionEnd;
                            const next = noteMarkdown.substring(0, start) + '  ' + noteMarkdown.substring(end);
                            setNoteMarkdown(next);
                            triggerAutoSave(noteTitle, next);
                            setTimeout(() => {
                              if (textareaRef.current) {
                                textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
                              }
                            }, 0);
                          }
                        }}
                        className="w-full flex-1 min-h-[400px] resize-none text-sm text-on-surface leading-relaxed outline-none font-mono bg-transparent border border-outline-variant/10 rounded-xl p-4 focus:border-primary/35 focus:ring-1 focus:ring-primary/20 transition-all overflow-y-auto"
                        style={{ outline: 'none' }}
                      />
                    </div>
                  ) : (
                    <div 
                      className="flex-1 min-h-[300px] text-sm text-on-surface leading-relaxed font-sans rich-editor select-text selection:bg-primary/10 markdown-preview"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === 'A') {
                          const href = target.getAttribute('href');
                          if (href) {
                            e.preventDefault();
                            handleLinkClick(href);
                          }
                        }
                      }}
                    >
                      <MarkdownRenderer 
                        content={noteMarkdown || '*No content yet. Click Edit or Split to write something...*'} 
                        className="flex-1"
                      />
                    </div>
                  )}

                  {backlinks.length > 0 && (
                    <div className="border-t border-outline-variant/15 pt-6 mt-8 select-none">
                      <h4 className="text-[10px] font-black uppercase text-outline tracking-wider flex items-center gap-1.5 mb-3">
                        <FileText className="w-3.5 h-3.5 text-primary" />
                        Backlinks & Mentions ({backlinks.length})
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {backlinks.map(b => (
                          <div 
                            key={b.id}
                            onClick={() => setSelectedNoteId(b.id)}
                            className="p-3 bg-surface-container-low hover:bg-primary/5 border border-outline-variant/10 hover:border-primary/20 rounded-xl cursor-pointer transition-all flex items-center gap-2"
                          >
                            <StickyNote className="w-4 h-4 text-primary" />
                            <span className="text-xs font-bold text-on-surface truncate">{b.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {linkModalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-8 bg-on-surface/40 backdrop-blur-sm">
                  <div className="bg-surface p-5 rounded-2xl border border-outline-variant/15 shadow-2xl max-w-sm w-full space-y-4 text-on-surface animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
                      <span className="text-xs font-black uppercase text-primary tracking-wider">Insert Note Link</span>
                      <button onClick={() => setLinkModalOpen(false)} className="text-outline hover:text-on-surface cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex bg-surface-container-low p-0.5 rounded-lg border border-outline-variant/10">
                      <button 
                        onClick={() => setLinkTab('material')}
                        className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded transition-all cursor-pointer ${
                          linkTab === 'material' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        Vault Material
                      </button>
                      <button 
                        onClick={() => setLinkTab('web')}
                        className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded transition-all cursor-pointer ${
                          linkTab === 'web' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        Web Link
                      </button>
                    </div>

                    {linkTab === 'material' ? (
                      <div className="flex flex-col gap-2">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search note or PDF titles..."
                            value={linkSearchQuery}
                            onChange={e => setLinkSearchQuery(e.target.value)}
                            className="w-full text-xs p-2 pl-8 border border-outline-variant/20 rounded-lg bg-surface-container-lowest focus:outline-none focus:border-primary text-on-surface"
                          />
                          <Search className="w-3.5 h-3.5 text-outline absolute left-2.5 top-3" />
                        </div>
                        <div className="max-h-36 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin">
                          {filteredMaterials.length === 0 ? (
                            <p className="text-[10px] text-outline text-center py-4 italic">No materials found.</p>
                          ) : (
                            filteredMaterials.map(m => (
                              <button
                                key={m.id}
                                onClick={() => insertLinkFormat('material', m.id, m.title)}
                                className="w-full text-left p-2 hover:bg-primary/5 hover:text-primary rounded-lg text-xs text-on-surface font-semibold truncate flex items-center gap-2 cursor-pointer"
                              >
                                {m.boxType === 'note' ? <StickyNote className="w-3.5 h-3.5 text-primary" /> : <FileText className="w-3.5 h-3.5 text-outline" />}
                                <span className="truncate">{m.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        <input
                          type="text"
                          placeholder="Link display text (e.g. 'Read More')"
                          value={linkDisplayName}
                          onChange={e => setLinkDisplayName(e.target.value)}
                          className="w-full text-xs p-2 border border-outline-variant/20 rounded-lg bg-surface-container-lowest focus:outline-none focus:border-primary text-on-surface"
                        />
                        <input
                          type="text"
                          placeholder="Web URL (https://...)"
                          value={linkWebUrl}
                          onChange={e => setLinkWebUrl(e.target.value)}
                          className="w-full text-xs p-2 border border-outline-variant/20 rounded-lg bg-surface-container-lowest focus:outline-none focus:border-primary text-on-surface"
                        />
                        <button
                          onClick={() => insertLinkFormat('web', linkWebUrl)}
                          className="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer"
                        >
                          Insert Link
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {imageModalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-8 bg-on-surface/40 backdrop-blur-sm">
                  <div className="bg-surface p-5 rounded-2xl border border-outline-variant/15 shadow-2xl max-w-md w-full space-y-4 text-on-surface animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
                      <span className="text-xs font-black uppercase text-primary tracking-wider">Insert Image Asset</span>
                      <button onClick={() => setImageModalOpen(false)} className="text-outline hover:text-on-surface cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex bg-surface-container-low p-0.5 rounded-lg border border-outline-variant/10">
                      <button 
                        onClick={() => setImageTab('local')}
                        className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded transition-all cursor-pointer ${
                          imageTab === 'local' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        Local File
                      </button>
                      <button 
                        onClick={() => setImageTab('search')}
                        className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded transition-all cursor-pointer ${
                          imageTab === 'search' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        Search Web
                      </button>
                      <button 
                        onClick={() => setImageTab('url')}
                        className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded transition-all cursor-pointer ${
                          imageTab === 'url' ? 'bg-surface text-primary shadow-sm' : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        Web Image URL
                      </button>
                    </div>

                    {imageTab === 'local' && (
                      <div className="space-y-3">
                        <p className="text-[11px] text-outline leading-normal text-center">
                          Select an image from your computer to securely copy and embed into this note.
                        </p>
                        <button
                          onClick={handleImportLocalImage}
                          className="w-full py-3 border-2 border-dashed border-outline-variant/40 hover:border-primary hover:bg-primary/5 rounded-xl text-xs font-bold text-outline hover:text-primary transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5"
                        >
                          <Image className="w-6 h-6" />
                          Choose Image File
                        </button>
                      </div>
                    )}

                    {imageTab === 'search' && (
                      <div className="flex flex-col gap-2.5">
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="Search web images (e.g. quantum, diagram, nature)..."
                            value={imageSearchQuery}
                            onChange={e => setImageSearchQuery(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleWebImageSearch();
                              }
                            }}
                            className="flex-1 text-xs p-2 border border-outline-variant/20 rounded-lg bg-surface-container-lowest focus:outline-none focus:border-primary text-on-surface"
                          />
                          <button
                            type="button"
                            onClick={handleWebImageSearch}
                            disabled={imageSearchLoading}
                            className="px-3.5 py-2 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {imageSearchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                            Search
                          </button>
                        </div>

                        {imageSearchLoading ? (
                          <div className="py-8 flex flex-col justify-center items-center gap-2">
                            <Loader2 className="w-5 h-5 border-primary text-primary animate-spin" />
                            <span className="text-[10px] font-medium text-outline">Searching web images...</span>
                          </div>
                        ) : imageSearchResults.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto p-1 border border-outline-variant/10 rounded-lg">
                            {imageSearchResults.map((url, idx) => (
                              <div 
                                key={idx}
                                onClick={() => insertImageFormat(url)}
                                className="aspect-square bg-surface-container rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all relative group border border-outline-variant/10"
                                title="Click to insert image"
                              >
                                <img src={url} alt="web result" className="w-full h-full object-cover" loading="lazy" />
                                <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/20 transition-all flex items-center justify-center">
                                  <Plus className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          imageSearchQuery && (
                            <div className="text-center text-xs text-outline py-6">
                              No web images found for "{imageSearchQuery}". Try a different keyword.
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {imageTab === 'url' && (
                      <div className="flex flex-col gap-2.5">
                        <input
                          type="text"
                          placeholder="Image Web URL (https://...)"
                          value={imageWebUrl}
                          onChange={e => setImageWebUrl(e.target.value)}
                          className="w-full text-xs p-2 border border-outline-variant/20 rounded-lg bg-surface-container-lowest focus:outline-none focus:border-primary text-on-surface"
                        />
                        <button
                          onClick={() => insertImageFormat(imageWebUrl)}
                          className="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer"
                        >
                          Embed Image
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showFolderModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-8 bg-on-surface/40 backdrop-blur-sm">
          <div className="bg-surface p-5 rounded-2xl border border-outline-variant/15 shadow-2xl max-w-sm w-full space-y-4 text-on-surface animate-fadeIn">
            <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
              <span className="text-xs font-black uppercase text-primary tracking-wider">Create Notes Folder</span>
              <button onClick={() => setShowFolderModal(false)} className="text-outline hover:text-on-surface cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Folder Name (e.g. 'Calculus Notes')"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                className="w-full text-xs p-2 border border-outline-variant/20 rounded-lg bg-surface-container-lowest focus:outline-none focus:border-primary text-on-surface"
                autoFocus
              />
              <button
                onClick={handleCreateFolder}
                className="w-full py-2 bg-primary text-on-primary text-xs font-bold rounded-lg hover:opacity-90 transition-all cursor-pointer"
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      <MathInsertModal
        isOpen={mathModalOpen}
        onClose={() => setMathModalOpen(false)}
        onInsert={(formattedMath) => insertMarkdownText(formattedMath)}
      />

    </div>
  );
}
