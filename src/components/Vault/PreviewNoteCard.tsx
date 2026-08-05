import { useState, useEffect, useRef } from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import { htmlToMarkdown, markdownToHtml, parseRichText } from '../../lib/editorUtils';

interface PreviewNoteCardProps {
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
}

export function PreviewNoteCard({
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
}: PreviewNoteCardProps) {
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
