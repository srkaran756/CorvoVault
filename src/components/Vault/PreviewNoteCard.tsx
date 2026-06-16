import { useState } from 'react';
import { Edit3, Trash2 } from 'lucide-react';

interface PreviewNoteCardProps {
  note: any;
  editingNoteId: string | null;
  editingNoteContent: string;
  setEditingNoteContent: (content: string) => void;
  startEditNote: (id: string, content: string) => void;
  confirmEditNote: (id: string) => void;
  cancelEditNote: () => void;
  deleteNote: (id: string) => void;
  setIsEditing: (val: boolean) => void;
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
}: PreviewNoteCardProps) {
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
export function parseRichText(text: string) {
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
