import { useState, useEffect, useRef, useCallback } from 'react';
import { ExternalLink, Globe, StickyNote, X, PlayCircle, Video, FileText, Pin, ChevronRight, Bold, Italic, List, ListOrdered, Image, Link, SendHorizontal, Sparkles, Loader2, Search, FileText as FileTextIcon, Eraser, Camera } from 'lucide-react';
import { useOverscroll } from '../../hooks/useOverscroll';
import { useMaterialNotes, useVideoProgress, useUserSettings } from '../../hooks/useLocalData';
import { useActivityTimer } from '../../hooks/useActivityTimer';
import { Material } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';
import { generateAIResponse } from '../../lib/ai';
import { ipcService } from '../../services/ipcService';
import { htmlToMarkdown, markdownToHtml, searchWebImages } from '../../lib/editorUtils';

import { YouTubeEmbed, YouTubeWebviewFallback } from './YouTubePlayer';
import { DocxPreview } from './DocxPreview';
import { PreviewNoteCard } from './PreviewNoteCard';

interface PreviewModalProps {
  material: Material;
  onClose: () => void;
  onOpenInBrowser: (url: string) => void;
  isActive?: boolean;
}

export function PreviewModal({ material, onClose, onOpenInBrowser, isActive = true }: PreviewModalProps) {
  const modalNotesOverscrollRef = useOverscroll();
  const { settings } = useUserSettings();

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

  const [aiSummarizing, setAiSummarizing] = useState(false);

  const handleAiSummarize = async () => {
    let resolvedProvider = settings?.selectedModel || 'gemini';
    let activeKey = '';
    let providerName = 'Gemini';

    if (resolvedProvider === 'gemini') {
      activeKey = settings?.geminiKey || '';
      providerName = 'Gemini';
    } else if (resolvedProvider === 'openrouter') {
      activeKey = settings?.openrouterKey || '';
      providerName = 'OpenRouter';
    } else if (resolvedProvider === 'openai') {
      activeKey = settings?.openaiKey || '';
      providerName = 'OpenAI';
    } else if (resolvedProvider === 'anthropic') {
      activeKey = settings?.anthropicKey || '';
      providerName = 'Anthropic';
    }

    if (!activeKey) {
      if (settings?.geminiKey) { resolvedProvider = 'gemini'; activeKey = settings.geminiKey; providerName = 'Gemini'; }
      else if (settings?.openrouterKey) { resolvedProvider = 'openrouter'; activeKey = settings.openrouterKey; providerName = 'OpenRouter'; }
      else if (settings?.openaiKey) { resolvedProvider = 'openai'; activeKey = settings.openaiKey; providerName = 'OpenAI'; }
      else if (settings?.anthropicKey) { resolvedProvider = 'anthropic'; activeKey = settings.anthropicKey; providerName = 'Anthropic'; }
    }

    if (!activeKey) {
      alert(`Please configure an AI API Key in Settings to generate AI summaries.`);
      return;
    }

    setAiSummarizing(true);

    try {
      let promptText = '';
      if (material.boxType === 'note') {
        promptText = `Summarize the following study note in clear bullet points:\n\n${material.url}`;
      } else {
        promptText = `Provide a detailed academic summary and study questions based on the following study resource:\n\nTitle: ${material.title}\nType: ${material.boxType}\nURL: ${material.url}`;
      }

      const out = { modelUsed: '' };
      const responseText = await generateAIResponse({
        provider: resolvedProvider,
        geminiKey: settings?.geminiKey,
        openrouterKey: settings?.openrouterKey,
        openaiKey: settings?.openaiKey,
        anthropicKey: settings?.anthropicKey
      }, {
        prompt: promptText,
        systemInstruction: "You are an elite academic study assistant. Your summaries are highly structured, clear, and action-oriented."
      }, out);

      if (responseText) {
        await addNote(`🤖 **AI Summary (${out.modelUsed || providerName})**\n\n${responseText}`);
      }
    } catch (err: any) {
      alert(`AI Summarize failed: ${err.message || 'Unknown error'}`);
    } finally {
      setAiSummarizing(false);
    }
  };

  useActivityTimer('YouTube', isActive && material.boxType === 'youtube');
  useActivityTimer('Documents', isActive && material.boxType === 'file');
  useActivityTimer('Notes', isActive && isEditing);

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

  useEffect(() => {
    setMediaError(null);
    setUseWebviewFallback(false);
  }, [material.id]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-on-surface/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-surface-container-lowest w-full max-w-6xl h-full max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex"
        onClick={e => e.stopPropagation()}
      >
        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-4 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
            <h3 className="font-black text-primary truncate pr-4">{material.title}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAiSummarize}
                disabled={aiSummarizing}
                className="px-3 py-1.5 bg-secondary/15 text-secondary hover:bg-secondary/25 disabled:opacity-40 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                {aiSummarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {aiSummarizing ? 'Summarizing...' : 'AI Summarize'}
              </button>
              {material.boxType !== 'note' && (
                <button
                  onClick={() => {
                    if (material.boxType === 'file') {
                      const targetUrl = material.localPath || material.url;
                      if (window.electronAPI) window.electronAPI.openExternal(targetUrl);
                      else window.open(targetUrl, '_blank');
                    } else {
                      onClose(); onOpenInBrowser(material.url);
                    }
                  }}
                  className="px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-bold flex items-center gap-1.5 hover:bg-primary/20 transition-all cursor-pointer"
                >
                  {material.boxType === 'file' ? <ExternalLink className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                  {material.boxType === 'file' ? 'Open Externally' : 'Open in Browser'}
                </button>
              )}
              <button
                onClick={() => setIsNotesCollapsed(!isNotesCollapsed)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  isNotesCollapsed
                    ? 'bg-primary text-on-primary shadow-sm hover:scale-[1.02]'
                    : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
                title={isNotesCollapsed ? "Show Notes" : "Hide Notes"}
              >
                <StickyNote className="w-3.5 h-3.5" />
                {isNotesCollapsed ? 'Show Notes' : 'Hide Notes'}
              </button>
              <button onClick={onClose} className="p-2 hover:bg-surface-container-high rounded-full transition-all cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 bg-surface-dim relative overflow-hidden">
            {mediaError ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant space-y-6 p-8">
                <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center">
                  <PlayCircle className="w-10 h-10 text-red-500 opacity-50" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold">Playback Issue</p>
                  <p className="text-sm text-outline max-w-md">{mediaError}</p>
                </div>
                <div className="flex gap-3">
                  {material.boxType === 'youtube' && window.electronAPI && (
                    <button
                      onClick={() => { setMediaError(null); setUseWebviewFallback(true); }}
                      className="bg-primary text-on-primary px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg cursor-pointer"
                    >
                      <Video className="w-5 h-5" />
                      Try Rescue Player
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const targetUrl = material.localPath || material.url;
                      if (window.electronAPI) window.electronAPI.openExternal(targetUrl);
                      else window.open(targetUrl, '_blank');
                    }}
                    className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg cursor-pointer ${material.boxType === 'youtube' ? 'bg-surface-container-high text-on-surface' : 'bg-primary text-on-primary'}`}
                  >
                    <ExternalLink className="w-5 h-5" />
                    Open Externally
                  </button>
                </div>
              </div>
            ) : material.boxType === 'youtube' ? (
              useWebviewFallback && Boolean(window.electronAPI) ? (
                <YouTubeWebviewFallback
                  url={material.url}
                  startSeconds={videoProgress?.currentTime}
                />
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
              )
            ) : material.boxType === 'file' && /\.(mp4|webm|ogg|mkv|mov|m4v|avi)$/i.test(material.localPath || material.url) ? (
              <video
                src={getFileSrc(material.localPath || material.url)}
                className="w-full h-full object-contain"
                controls
                autoPlay
                onError={() => setMediaError("Failed to load local video file. The file might be corrupted or in an unsupported format.")}
                onTimeUpdate={(e) => {
                  const target = e.target as HTMLVideoElement;
                  if (Math.abs(target.currentTime - (videoProgress?.currentTime || 0)) > 5) {
                    updateProgress(target.currentTime, target.duration);
                  }
                }}
                onLoadedMetadata={(e) => {
                  if (
                    videoProgress &&
                    Math.abs(videoProgress.currentTime - (e.target as HTMLVideoElement).currentTime) > 2
                  ) {
                    (e.target as HTMLVideoElement).currentTime = videoProgress.currentTime;
                  }
                }}
              />
            ) : material.boxType === 'file' && (material.url.endsWith('.png') || material.url.endsWith('.jpg') || material.url.endsWith('.jpeg') || material.url.endsWith('.gif') || material.url.endsWith('.webp')) ? (
              <img
                src={getFileSrc(material.localPath || material.url)}
                className="w-full h-full object-contain"
                alt={material.title}
                onError={() => setMediaError("Failed to load image.")}
              />
            ) : material.boxType === 'file' && material.url.endsWith('.pdf') ? (
              Boolean(window.electronAPI) ? (
                <webview
                  src={getFileSrc(material.localPath || material.url)}
                  className="w-full h-full"
                  ref={(ref: any) => {
                    if (ref) {
                      ref.addEventListener('did-fail-load', (e: any) => {
                        setMediaError(`Failed to load PDF: ${e.errorDescription || 'Unknown Error'}`);
                      });
                    }
                  }}
                />
              ) : (
                <iframe
                  src={material.url}
                  className="w-full h-full border-none"
                  onError={() => setMediaError("Failed to load PDF in frame.")}
                />
              )
            ) : material.boxType === 'file' && /\.(docx?|odt|rtf)$/i.test(material.url) ? (
              <DocxPreview filePath={material.localPath || material.url} />
            ) : material.boxType === 'note' ? (
              <div className="p-8 text-on-surface">
                <p className="text-lg leading-relaxed whitespace-pre-wrap">{material.url}</p>
              </div>
            ) : material.boxType === 'link' ? (
              Boolean(window.electronAPI) ? (
                <webview
                  src={material.url}
                  className="w-full h-full border-none"
                  // @ts-ignore
                  allowpopups="true"
                  ref={(ref: any) => {
                    if (ref) {
                      ref.addEventListener('did-fail-load', (e: any) => {
                        setMediaError(`Failed to connect to this website: ${e.errorDescription || 'Connection Refused'}`);
                      });
                    }
                  }}
                />
              ) : (
                <iframe
                  src={material.url}
                  className="w-full h-full border-none"
                  sandbox="allow-scripts allow-same-origin"
                  onError={() => setMediaError("This website refused to be embedded. Try opening it in a new window.")}
                />
              )
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant space-y-6 p-8">
                <FileText className="w-16 h-16 opacity-20" />
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold">File Document</p>
                  <p className="text-sm text-outline max-w-md">This file type requires an external application to view.</p>
                </div>
                <button
                  onClick={() => {
                    const targetUrl = material.localPath || material.url;
                    if (window.electronAPI) window.electronAPI.openExternal(targetUrl);
                    else window.open(targetUrl, '_blank');
                  }}
                  className="bg-primary text-on-primary px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg cursor-pointer"
                >
                  <ExternalLink className="w-5 h-5" />
                  Open in Default App
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Note Side Panel Wrapper */}
        <div className="relative h-full flex shrink-0">
          {/* Toggle Handle floating absolute to the left of the sidebar */}
          <button
            onClick={() => setIsNotesCollapsed(!isNotesCollapsed)}
            className={`absolute top-1/2 -translate-y-1/2 -left-[10px] w-5 h-10 bg-surface-container-highest border border-outline-variant/30 rounded-full shadow-md flex flex-col gap-[2px] items-center justify-center cursor-pointer hover:bg-primary/10 hover:border-primary/50 transition-all z-[60] ${
              isNotesCollapsed ? 'rotate-180 translate-x-[10px]' : ''
            }`}
            title={isNotesCollapsed ? "Expand Notes" : "Collapse Notes"}
          >
            <div className="w-[1.5px] h-2.5 bg-outline/60 rounded-full" />
            <div className="w-[1.5px] h-2.5 bg-outline/60 rounded-full" />
            <div className="w-[1.5px] h-2.5 bg-outline/60 rounded-full" />
          </button>

          {/* Sidebar Notes Panel */}
          <div className={`transition-all duration-300 ease-in-out border-l border-outline-variant/10 flex flex-col bg-surface-container-low h-full ${
            isNotesCollapsed ? 'w-0 opacity-0 overflow-hidden border-l-0' : 'w-72 opacity-100'
          }`}>
            <div className="w-72 h-full flex flex-col">
              <div className="p-3.5 border-b border-outline-variant/10 flex items-center justify-between shrink-0 select-none">
              <h4 className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2 text-on-surface font-headline">
                <StickyNote className="w-3.5 h-3.5 text-primary" />
                Notes
              </h4>
              <div className="flex items-center gap-1 text-outline">
                <button className="p-1 hover:bg-surface-container-high text-outline hover:text-on-surface rounded-lg transition-colors cursor-pointer" title="Pin Note">
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
            
            {/* Scrollable list */}
            <div ref={modalNotesOverscrollRef} className="flex-1 overflow-y-auto p-3 space-y-3.5 no-scrollbar">
              {notes.length === 0 && (
                <p className="text-[10px] text-outline italic p-2">No notes yet. Add one below.</p>
              )}
              {notes.map(note => (
                <PreviewNoteCard
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

            {/* Input box */}
            <div className="p-3 border-t border-outline-variant/10 shrink-0 bg-surface-container-low relative">
              <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all relative">
                <div
                  ref={editorRef}
                  contentEditable
                  onInput={handleEditorInput}
                  onFocus={() => setIsEditing(true)}
                  onBlur={() => setIsEditing(false)}
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
                                <FileTextIcon className="w-3 h-3 text-outline" />
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
        </div>
      </motion.div>
    </div>
  );
}
