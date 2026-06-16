import React, { useState } from 'react';
import { StickyNote, Edit3, Trash2, BookOpen, ChevronLeft, ChevronRight, Bold, Italic, List, ListOrdered, Image, Link, SendHorizontal, Pin } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMaterialNotes } from '../../hooks/useLocalData';
import { useActivityTimer } from '../../hooks/useActivityTimer';
import { Material } from '../../types';
import { useOverscroll } from '../../hooks/useOverscroll';

interface NoteEditorProps {
  data: Material;
  isActive?: boolean;
}

export default function NoteEditor({ data: material, isActive = true }: NoteEditorProps) {
  const { notes, addNote, deleteNote, updateNote } = useMaterialNotes(material.id);
  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isNotesCollapsed, setIsNotesCollapsed] = useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

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
  const mainOverscrollRef = useOverscroll();
  const notesOverscrollRef = useOverscroll();

  // Well-being time tracking for notes
  useActivityTimer('Notes', isActive); // Active time spent studying/reviewing notes

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

  return (
    <div className="h-full flex bg-surface-container-lowest select-none">
      {/* Left Column: Note Text Body */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface relative h-full">
        {/* Quick Toolbar */}
        <div className="p-3 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low select-none shrink-0">
          <div className="flex items-center gap-2 truncate max-w-[70%]">
            <BookOpen className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-black text-primary truncate">{material.title}</span>
          </div>
          <button
            onClick={() => setIsNotesCollapsed(!isNotesCollapsed)}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              isNotesCollapsed 
                ? 'bg-primary text-on-primary shadow-sm hover:scale-[1.02]' 
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
            title={isNotesCollapsed ? "Show Notes" : "Hide Notes"}
          >
            <StickyNote className="w-3 h-3" />
            {isNotesCollapsed ? 'Show Notes' : 'Hide Notes'}
          </button>
        </div>
        
        {/* Body content */}
        <div ref={mainOverscrollRef} className="flex-1 overflow-y-auto p-12 max-w-3xl mx-auto w-full select-text selection:bg-on-primary-container/20">
          <h1 className="text-3xl font-extrabold font-headline tracking-tight text-primary mb-6 leading-tight">
            {material.title}
          </h1>
          <div className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap font-sans">
            {material.url}
          </div>
        </div>
      </div>

      {/* Right Column: Notes Panel — no absolute-positioned children */}
      <div className={`flex flex-col shrink-0 h-full border-l border-outline-variant/10 bg-surface-container-low transition-[width,opacity] duration-300 ease-in-out ${
        isNotesCollapsed ? 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none' : 'w-72 opacity-100'
      }`}>
        {/* Panel header */}
        <div className="p-3.5 border-b border-outline-variant/10 flex items-center justify-between shrink-0 select-none">
          <h4 className="text-[10px] font-black uppercase tracking-wider flex items-center gap-2 text-on-surface font-headline font-semibold">
            <StickyNote className="w-3.5 h-3.5 text-primary" />
            Annotated Links
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
    <div className="p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/15 group shadow-sm transition-all hover:shadow-md flex flex-col gap-2 relative text-left">
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            className="w-full h-28 bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-xs resize-none focus:outline-none focus:border-primary font-sans"
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
