import React from 'react';
import { Trash2, Underline, Strikethrough, Copy } from 'lucide-react';

interface SelectionToolbarProps {
  materialId: string;
  pageNum: number;
  selectionToolbar: {
    x: number;
    y: number;
    text: string;
    existingHighlightId?: string;
  };
  deleteHighlight: (id: string) => void;
  addTextHighlight: (color: string) => void;
  addTextMark: (type: 'highlight' | 'underline' | 'strike' | 'circle', color: string) => void;
  copySelectedText: () => void;
}

export default function SelectionToolbar({
  materialId,
  pageNum,
  selectionToolbar,
  deleteHighlight,
  addTextHighlight,
  addTextMark,
  copySelectedText,
}: SelectionToolbarProps) {
  return (
    <div
      id={`pdf-selection-toolbar-${materialId}-${pageNum}`}
      className="absolute z-40 flex items-center gap-1.5 rounded-lg bg-neutral-950 text-white shadow-xl border border-white/10 px-2 py-1 select-none animate-in fade-in zoom-in-95 duration-100"
      style={{ left: selectionToolbar.x, top: selectionToolbar.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {selectionToolbar.existingHighlightId ? (
        <button
          onClick={() => deleteHighlight(selectionToolbar.existingHighlightId!)}
          className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors cursor-pointer flex items-center gap-1"
          title="Delete mark"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold pr-0.5">Delete</span>
        </button>
      ) : (
        <>
          {[
            'rgba(253,224,71,0.55)',
            'rgba(34,197,94,0.4)',
            'rgba(59,130,246,0.35)',
            'rgba(236,72,153,0.35)',
          ].map((color) => (
            <button
              key={color}
              onClick={() => addTextHighlight(color)}
              className="w-5 h-5 rounded border border-white/25 cursor-pointer hover:scale-110 active:scale-95 transition-transform"
              style={{ backgroundColor: color.replace(/[\d.]+\)$/, '0.9)') }}
              title="Highlight"
            />
          ))}
          <button
            onClick={() => addTextMark('underline', '#ef4444')}
            className="p-1 rounded hover:bg-white/10 cursor-pointer text-white/80 hover:text-white transition-colors"
            title="Underline"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => addTextMark('strike', '#ef4444')}
            className="p-1 rounded hover:bg-white/10 cursor-pointer text-white/80 hover:text-white transition-colors"
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      <div className="w-[1px] h-4 bg-white/15 mx-0.5" />

      <button
        onClick={copySelectedText}
        className="p-1 rounded hover:bg-white/10 cursor-pointer text-white/80 hover:text-white transition-colors"
        title="Copy selection"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
