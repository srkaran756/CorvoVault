import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Globe, StickyNote, X, PlayCircle, Video, FileText, Pin, ChevronRight, Bold, Italic, List, ListOrdered, Image, Link, SendHorizontal, Sparkles, Loader2 } from 'lucide-react';
import { useOverscroll } from '../../hooks/useOverscroll';
import { useMaterialNotes, useVideoProgress, useUserSettings } from '../../hooks/useLocalData';
import { useActivityTimer } from '../../hooks/useActivityTimer';
import { Material } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';
import { generateAIResponse } from '../../lib/ai';

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

  const getFileSrc = (p: string | undefined | null) => {
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
  };

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

  useActivityTimer('YouTube', isActive && material.boxType === 'youtube');
  useActivityTimer('Documents', isActive && material.boxType === 'file');
  useActivityTimer('Notes', isActive && isEditing);

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
                />
              ))}
            </div>

            {/* Input box */}
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
                {/* Toolbar Footer inside Card */}
                <div className="flex items-center justify-between px-3 py-2 bg-surface-container-lowest border-t border-outline-variant/5">
                  {/* Formatter Buttons */}
                  <div className="flex items-center gap-1.5 text-outline">
                    <button
                      onClick={() => insertFormat('bold')}
                      className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Bold"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => insertFormat('italic')}
                      className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Italic"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => insertFormat('bullet')}
                      className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Bulleted List"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => insertFormat('number')}
                      className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Numbered List"
                    >
                      <ListOrdered className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => insertFormat('link')}
                      className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Add Link"
                    >
                      <Link className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => insertFormat('image')}
                      className="p-1.5 hover:bg-surface-container-high rounded text-outline hover:text-on-surface transition-colors cursor-pointer"
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
      </motion.div>
    </div>
  );
}
