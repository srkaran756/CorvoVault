import React, { useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Sun,
  Moon,
  Eye,
  Check,
  Pencil,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Loader2,
  Presentation,
  Sparkles,
  BookOpen,
  StickyNote,
  Maximize,
} from 'lucide-react';

interface PdfToolbarProps {
  currentPage: number;
  numPages: number;
  jumpToPage: (page: number) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  rotation: number;
  setRotation: React.Dispatch<React.SetStateAction<number>>;
  readingFilter: 'default' | 'sepia' | 'dark';
  setReadingFilter: (filter: 'default' | 'sepia' | 'dark') => void;
  isDrawMode: boolean;
  setIsDrawMode: React.Dispatch<React.SetStateAction<boolean>>;
  activeTool: 'pen' | 'highlighter' | 'eraser';
  setActiveTool: (tool: 'pen' | 'highlighter' | 'eraser') => void;
  penColor: string;
  setPenColor: (color: string) => void;
  penWidth: number;
  setPenWidth: (width: number) => void;
  highlighterColor: string;
  setHighlighterColor: (color: string) => void;
  highlighterWidth: number;
  setHighlighterWidth: (width: number) => void;
  runAnnotationCommand: (command: 'undo' | 'redo' | 'clear') => void;
  clearPageAnnotations: () => void;
  ingestionStatus: { status: string; progress: number } | null;
  workspaceMode: 'read' | 'study' | 'research' | 'deep' | 'blackboard' | 'custom';
  onSetWorkspaceMode: (mode: 'read' | 'study' | 'research' | 'deep' | 'blackboard') => void;
}

export default function PdfToolbar({
  currentPage,
  numPages,
  jumpToPage,
  zoom,
  setZoom,
  rotation,
  setRotation,
  readingFilter,
  setReadingFilter,
  isDrawMode,
  setIsDrawMode,
  activeTool,
  setActiveTool,
  penColor,
  setPenColor,
  penWidth,
  setPenWidth,
  highlighterColor,
  setHighlighterColor,
  highlighterWidth,
  setHighlighterWidth,
  runAnnotationCommand,
  clearPageAnnotations,
  ingestionStatus,
  workspaceMode,
  onSetWorkspaceMode,
}: PdfToolbarProps) {
  const pageInputRef = useRef<HTMLInputElement>(null);

  const modes = [
    { key: 'read', label: 'Read', icon: <BookOpen className="w-3.5 h-3.5" />, tooltip: 'Read Mode: PDF & Pages list' },
    { key: 'study', label: 'Study', icon: <Sparkles className="w-3.5 h-3.5 text-yellow-300" />, tooltip: 'Study Mode: PDF & AI Tutor Chat' },
    { key: 'research', label: 'Research', icon: <StickyNote className="w-3.5 h-3.5" />, tooltip: 'Research Mode: PDF & Lecture Notes' },
    { key: 'blackboard', label: 'Board', icon: <Presentation className="w-3.5 h-3.5" />, tooltip: 'Board Mode: Blackboard Canvas' },
    { key: 'deep', label: 'Focus', icon: <Maximize className="w-3.5 h-3.5" />, tooltip: 'Deep Focus: Document only' },
  ] as const;

  return (
    // Wrapper: flex column so the annotation strip sits below without overflowing
    <div className="shrink-0 bg-surface border-b border-outline-variant/10 z-40 relative" style={{ isolation: 'isolate' }}>

      {/* ── MAIN TOOLBAR ROW ── */}
      <div className="h-10 px-2 flex items-center justify-between gap-2">

        {/* LEFT: Page nav + Workspace mode */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {/* Page navigation */}
          <div className="flex items-center gap-0.5 bg-surface-container border border-outline-variant/15 rounded-lg p-0.5">
            <button
              onClick={() => jumpToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1 px-1.5">
              <input
                ref={pageInputRef}
                type="number"
                min={1}
                max={numPages}
                value={currentPage}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (v >= 1 && v <= numPages) jumpToPage(v);
                }}
                className="w-9 text-center text-[11px] font-bold bg-surface rounded border border-outline-variant/20 focus:outline-none focus:border-primary py-0.5"
              />
              <span className="text-[10px] text-outline">/ {numPages}</span>
            </div>
            <button
              onClick={() => jumpToPage(currentPage + 1)}
              disabled={currentPage >= numPages}
              className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Workspace mode segmented control */}
          <div className="flex items-center bg-surface-container border border-outline-variant/15 rounded-xl p-0.5 gap-0.5 shadow-sm">
            {modes.map(m => {
              const isActive = workspaceMode === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => onSetWorkspaceMode(m.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wide transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-primary text-on-primary shadow-sm scale-[1.02]'
                      : 'text-outline hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                  title={m.tooltip}
                >
                  {m.icon}
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CENTER: Zoom + Rotate */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-surface-container border border-outline-variant/15 rounded-lg p-0.5">
            <button
              onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(1)))}
              className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom(1.2)}
              className="px-2 text-[10px] font-bold text-outline hover:text-on-surface cursor-pointer min-w-[42px] text-center"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom(z => Math.min(3.0, +(z + 0.1).toFixed(1)))}
              className="p-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={() => setRotation(r => (r + 90) % 360)}
            className="p-1.5 hover:bg-surface-container-high text-outline hover:text-on-surface rounded-lg border border-outline-variant/15 bg-surface cursor-pointer"
            title="Rotate"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* RIGHT: Reading filter + Annotate toggle + Ingestion status */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Reading filter */}
          <div className="flex items-center bg-surface-container border border-outline-variant/15 rounded-lg p-0.5 gap-0.5">
            {([
              { key: 'default', icon: <Sun className="w-3 h-3" />, label: 'Light' },
              { key: 'sepia', icon: <Eye className="w-3 h-3 text-amber-600" />, label: 'Sepia' },
              { key: 'dark', icon: <Moon className="w-3 h-3" />, label: 'Night' },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setReadingFilter(f.key)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${
                  readingFilter === f.key ? 'bg-surface text-on-surface shadow-sm' : 'text-outline hover:text-on-surface'
                }`}
                title={f.label}
              >
                {f.icon}
                <span className="hidden sm:inline">{f.label}</span>
              </button>
            ))}
          </div>

          {/* Annotate toggle button — sub-toolbar opens in the row below */}
          <button
            onClick={() => setIsDrawMode(d => !d)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide cursor-pointer transition-all border ${
              isDrawMode
                ? 'bg-primary text-on-primary border-primary shadow-sm'
                : 'text-outline border-outline-variant/15 bg-surface-container hover:text-on-surface hover:bg-surface-container-high'
            }`}
            title="Toggle Annotation Mode"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Annotate</span>
          </button>

          {/* Ingestion Status indicator */}
          {ingestionStatus && ingestionStatus.status !== 'ready' && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 bg-surface-container border border-outline-variant/10 rounded-lg text-[8px] font-bold text-outline uppercase tracking-wider cursor-help"
              title={`AI Document Map Status: ${ingestionStatus.status} (${ingestionStatus.progress}%)`}
              onClick={() => onSetWorkspaceMode('study')}
            >
              {ingestionStatus.status === 'processing' ? (
                <Loader2 className="w-2.5 h-2.5 text-primary animate-spin" />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
              )}
              <span className="hidden md:inline">indexing {ingestionStatus.progress}%</span>
            </div>
          )}
        </div>
      </div>

      {/* ── ANNOTATION SUB-TOOLBAR (second row, only when draw mode active) ── */}
      {isDrawMode && (
        <div className="h-9 px-3 flex items-center gap-2 border-t border-primary/10 bg-primary/5 overflow-hidden">
          {/* Tool selector */}
          <div className="flex items-center gap-0.5 bg-surface-container border border-outline-variant/15 rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setActiveTool('highlighter')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${activeTool === 'highlighter' ? 'bg-yellow-400/25 text-yellow-600' : 'text-outline hover:text-on-surface'}`}
              title="Highlighter"
            >
              <Highlighter className="w-3.5 h-3.5" />
              <span>Highlight</span>
            </button>
            <button
              onClick={() => setActiveTool('pen')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${activeTool === 'pen' ? 'bg-primary/15 text-primary' : 'text-outline hover:text-on-surface'}`}
              title="Pen"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Pen</span>
            </button>
            <button
              onClick={() => setActiveTool('eraser')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${activeTool === 'eraser' ? 'bg-red-400/15 text-red-500' : 'text-outline hover:text-on-surface'}`}
              title="Eraser"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Erase</span>
            </button>
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-outline-variant/20 shrink-0" />

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => runAnnotationCommand('undo')}
              className="p-1.5 rounded cursor-pointer text-outline hover:text-on-surface hover:bg-surface-container-high"
              title="Undo annotation"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => runAnnotationCommand('redo')}
              className="p-1.5 rounded cursor-pointer text-outline hover:text-on-surface hover:bg-surface-container-high"
              title="Redo annotation"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Size slider — only for pen & highlighter */}
          {activeTool !== 'eraser' && (
            <>
              <div className="w-px h-5 bg-outline-variant/20 shrink-0" />
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] font-bold text-outline uppercase tracking-wide">Size</span>
                <input
                  type="range"
                  min={activeTool === 'highlighter' ? 4 : 1}
                  max={activeTool === 'highlighter' ? 20 : 8}
                  value={activeTool === 'highlighter' ? highlighterWidth : penWidth}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    activeTool === 'highlighter' ? setHighlighterWidth(v) : setPenWidth(v);
                  }}
                  className="w-20 h-1 bg-outline-variant/30 rounded-lg appearance-none cursor-pointer accent-primary"
                  title={`Size: ${activeTool === 'highlighter' ? highlighterWidth : penWidth}px`}
                />
                <span className="text-[9px] font-bold text-outline w-5 text-center">
                  {activeTool === 'highlighter' ? highlighterWidth : penWidth}
                </span>
              </div>
            </>
          )}

          {/* Color swatches — pen */}
          {activeTool === 'pen' && (
            <>
              <div className="w-px h-5 bg-outline-variant/20 shrink-0" />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-bold text-outline uppercase tracking-wide">Color</span>
                {['#ef4444', '#3b82f6', '#10b981', '#111827'].map(c => (
                  <button
                    key={c}
                    onClick={() => setPenColor(c)}
                    style={{ backgroundColor: c }}
                    className="w-4 h-4 rounded-full border-2 border-white/40 flex items-center justify-center cursor-pointer shadow-sm transition-transform hover:scale-110"
                    title={c}
                  >
                    {penColor === c && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Color swatches — highlighter */}
          {activeTool === 'highlighter' && (
            <>
              <div className="w-px h-5 bg-outline-variant/20 shrink-0" />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-bold text-outline uppercase tracking-wide">Color</span>
                {[
                  'rgba(253,224,71,0.5)',
                  'rgba(34,197,94,0.4)',
                  'rgba(59,130,246,0.4)',
                  'rgba(236,72,153,0.4)',
                ].map(c => (
                  <button
                    key={c}
                    onClick={() => setHighlighterColor(c)}
                    style={{ backgroundColor: c.replace(/[\d.]+\)$/, '0.85)') }}
                    className="w-4 h-4 rounded-full border-2 border-white/40 flex items-center justify-center cursor-pointer shadow-sm transition-transform hover:scale-110"
                    title="Highlight color"
                  >
                    {highlighterColor === c && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Spacer + Clear */}
          <div className="flex-1" />
          <button
            onClick={clearPageAnnotations}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold text-outline hover:text-red-500 hover:bg-red-50 cursor-pointer transition-colors border border-outline-variant/15 shrink-0"
            title="Clear all annotations on this page"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear Page</span>
          </button>
        </div>
      )}
    </div>
  );
}
