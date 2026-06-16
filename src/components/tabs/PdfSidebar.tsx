import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Bookmark, Trash2, Loader2, PanelLeftClose } from 'lucide-react';
import { OutlineItem } from '../../hooks/usePdfDocument';
import { StudyBookmark } from '../../hooks/usePdfBookmarks';

interface PdfSidebarProps {
  materialId: string;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  sidebarTab: 'thumbnails' | 'outline' | 'bookmarks';
  setSidebarTab: (tab: 'thumbnails' | 'outline' | 'bookmarks') => void;
  numPages: number;
  pdfDoc: any;
  currentPage: number;
  jumpToPage: (page: number) => void;
  sidebarScrollRoot: HTMLDivElement | null;
  sidebarScrollContainerRef: (node: HTMLDivElement | null) => void;
  outline: OutlineItem[];
  newBookmarkLabel: string;
  setNewBookmarkLabel: (val: string) => void;
  handleAddBookmark: (page: number) => void;
  handleDeleteBookmark: (id: string) => void;
  studyBookmarks: StudyBookmark[];
}

export default function PdfSidebar({
  materialId,
  isSidebarOpen,
  setIsSidebarOpen,
  sidebarTab,
  setSidebarTab,
  numPages,
  pdfDoc,
  currentPage,
  jumpToPage,
  sidebarScrollRoot,
  sidebarScrollContainerRef,
  outline,
  newBookmarkLabel,
  setNewBookmarkLabel,
  handleAddBookmark,
  handleDeleteBookmark,
  studyBookmarks,
}: PdfSidebarProps) {
  
  const navigateToDestination = async (dest: any) => {
    if (!pdfDoc || !dest) return;
    try {
      let pageRef = dest;
      if (typeof dest === 'string') {
        const arr = await pdfDoc.getDestination(dest);
        if (arr?.length > 0) pageRef = arr[0];
      } else if (Array.isArray(dest)) {
        pageRef = dest[0];
      }
      if (pageRef) {
        const idx = await pdfDoc.getPageIndex(pageRef);
        jumpToPage(idx + 1);
      }
    } catch (e) {
      console.error('Outline nav error:', e);
    }
  };

  const renderOutlineTree = (items: OutlineItem[], level = 0): React.ReactNode =>
    items.map((item, idx) => (
      <div key={`${level}-${idx}`} style={{ paddingLeft: `${level * 12}px` }}>
        <button
          onClick={() => navigateToDestination(item.dest)}
          className="w-full text-left py-1 px-2 rounded-lg hover:bg-surface-container-high transition-colors text-[11px] font-medium text-on-surface truncate flex items-center gap-1.5 shrink-0 cursor-pointer"
          title={item.title}
        >
          <BookOpen className="w-3 h-3 text-outline shrink-0" />
          <span className="truncate">{item.title}</span>
        </button>
        {item.items?.length > 0 && renderOutlineTree(item.items, level + 1)}
      </div>
    ));

  return (
    <div className="w-56 border-r border-outline-variant/15 bg-surface-container-low flex flex-col shrink-0">
      {/* Tab header */}
      <div className="px-2 pt-2 pb-0 border-b border-outline-variant/10 flex items-center justify-between gap-1 shrink-0 bg-surface">
        <div className="flex gap-0.5">
          {(['thumbnails', 'outline', 'bookmarks'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              className={`px-2 py-1.5 text-[9px] font-black rounded-t-lg uppercase tracking-wider transition-colors cursor-pointer border-b-2 ${
                sidebarTab === tab
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-outline hover:text-on-surface'
              }`}
            >
              {tab === 'thumbnails' ? 'Pages' : tab === 'outline' ? 'Contents' : 'Marks'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="p-1 mb-1 hover:bg-surface-container-high rounded text-outline hover:text-on-surface cursor-pointer"
          title="Close Sidebar"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab content */}
      <div
        ref={sidebarScrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 scrollbar-thin scrollbar-thumb-outline-variant/30"
      >
        {/* ── THUMBNAILS ── */}
        {sidebarTab === 'thumbnails' && (
          <div className="space-y-1.5">
            {Array.from({ length: numPages }).map((_, i) => (
              <PdfThumbnailItem
                key={i + 1}
                pageNum={i + 1}
                pdfDoc={pdfDoc}
                isActive={currentPage === i + 1}
                onClick={() => jumpToPage(i + 1)}
                sidebarScrollEl={sidebarScrollRoot}
              />
            ))}
          </div>
        )}

        {/* ── OUTLINE ── */}
        {sidebarTab === 'outline' && (
          <div className="space-y-0.5">
            {outline.length === 0 ? (
              <p className="text-[10px] text-outline italic text-center p-4">No table of contents found.</p>
            ) : (
              renderOutlineTree(outline)
            )}
          </div>
        )}

        {/* ── BOOKMARKS ── */}
        {sidebarTab === 'bookmarks' && (
          <div className="space-y-3">
            <div className="space-y-1.5 p-2 bg-surface rounded-xl border border-outline-variant/10">
              <span className="text-[9px] uppercase font-black text-outline tracking-wider">Save Position</span>
              <input
                type="text"
                placeholder={`Page ${currentPage} — add note...`}
                value={newBookmarkLabel}
                onChange={e => setNewBookmarkLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddBookmark(currentPage)}
                className="w-full text-xs p-1.5 border border-outline-variant/20 rounded-lg focus:outline-none focus:border-primary bg-surface-container-lowest"
              />
              <button
                onClick={() => handleAddBookmark(currentPage)}
                className="w-full py-1.5 bg-primary text-on-primary text-[10px] font-bold rounded-lg hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
              >
                <Bookmark className="w-3 h-3" />
                Bookmark Page {currentPage}
              </button>
            </div>

            <div className="space-y-1.5">
              {studyBookmarks.length === 0 ? (
                <p className="text-[10px] text-outline italic px-1">No bookmarks yet.</p>
              ) : (
                studyBookmarks.map(b => (
                  <div
                    key={b.id}
                    className="group p-2 bg-surface rounded-xl border border-outline-variant/10 hover:border-primary/30 transition-all flex items-center justify-between gap-1"
                  >
                    <button
                      onClick={() => jumpToPage(b.pageNum)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <p className="text-[11px] font-semibold text-on-surface truncate">{b.label}</p>
                      <span className="text-[9px] text-primary font-bold">Page {b.pageNum}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteBookmark(b.id)}
                      className="p-1 opacity-0 group-hover:opacity-100 text-outline hover:text-red-500 rounded transition-all cursor-pointer"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── THUMBNAIL SUBCOMPONENT ──────────────────────────────────────────────────
function PdfThumbnailItem({
  pageNum,
  pdfDoc,
  isActive,
  onClick,
  sidebarScrollEl,
}: {
  pageNum: number;
  pdfDoc: any;
  isActive: boolean;
  onClick: () => void;
  sidebarScrollEl: HTMLDivElement | null;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el || !sidebarScrollEl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      {
        root: sidebarScrollEl,
        rootMargin: '450px 0px 450px 0px', // Buffer zone to pre-render thumbnails
      }
    );

    observer.observe(el);
    return () => {
      observer.unobserve(el);
    };
  }, [sidebarScrollEl]);

  useEffect(() => {
    if (!pdfDoc || !isIntersecting) return;

    let active = true;
    let task: any;

    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use a proper scale for sidebar thumbnails — scale to fixed width 120px
        const naturalViewport = page.getViewport({ scale: 1 });
        const targetWidth = 120;
        const scale = targetWidth / naturalViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
        if (active) setRendered(true);
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException' && active) setError(true);
      }
    };

    render();
    return () => {
      active = false;
      task?.cancel?.();
    };
  }, [pdfDoc, pageNum, isIntersecting]);

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      style={{ minHeight: '130px' }} // Keep a stable minimum height to prevent scroll collapsing
      className={`w-full flex flex-col items-center gap-1.5 p-1.5 rounded-xl border transition-all cursor-pointer group ${
        isActive
          ? 'border-primary bg-primary/8 shadow-md'
          : 'border-outline-variant/15 hover:border-outline/30 hover:bg-surface-container-high/40'
      }`}
    >
      <div className="w-full rounded-lg overflow-hidden border border-outline-variant/10 shadow-sm bg-white relative">
        {!isIntersecting ? (
          <div className="w-full aspect-[3/4] flex items-center justify-center bg-surface-container-low">
            <Loader2 className="w-4 h-4 animate-spin text-primary/30" />
          </div>
        ) : error ? (
          <div className="w-full aspect-[3/4] flex items-center justify-center bg-surface-container-low">
            <span className="text-[9px] text-outline">Page {pageNum}</span>
          </div>
        ) : (
          <>
            {!rendered && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low z-10">
                <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              </div>
            )}
            <canvas ref={canvasRef} className="w-full block" />
          </>
        )}
      </div>
      <span
        className={`text-[9px] font-bold ${
          isActive ? 'text-primary' : 'text-outline group-hover:text-on-surface'
        }`}
      >
        {pageNum}
      </span>
    </button>
  );
}
