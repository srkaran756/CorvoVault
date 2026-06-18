import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ProcessedTextItem,
  CustomSelectionPoint,
  findSelectionPoint,
  findWordBoundaries,
  getCustomSelectionRects,
  getCustomSelectionText,
} from '../lib/pdfSelectionEngine';

export interface TextHighlight {
  id: string;
  type?: 'highlight' | 'underline' | 'strike' | 'circle';
  color: string;
  rects: { x: number; y: number; w: number; h: number }[];
  text: string;
  createdAt: string;
  source?: 'user' | 'professor';
  callout?: string;
  targetPage?: number;
}

export interface SelectionToolbarState {
  x: number;
  y: number;
  text: string;
  rects: TextHighlight['rects'];
  existingHighlightId?: string;
}

interface UsePdfSelectionProps {
  materialId: string;
  pageNum: number;
  dimensions: { w: number; h: number };
  scrollContainerEl: HTMLDivElement | null;
  activeSelectionPage: number | null;
  setActiveSelectionPage: (pageNum: number | null) => void;
  onSelectionActiveChange?: (active: boolean) => void;
  isDrawMode: boolean;
  processedTextItemsRef: React.MutableRefObject<ProcessedTextItem[]>;
  highlightReloadTrigger?: number;
}

export function usePdfSelection({
  materialId,
  pageNum,
  dimensions,
  scrollContainerEl,
  activeSelectionPage,
  setActiveSelectionPage,
  onSelectionActiveChange,
  isDrawMode,
  processedTextItemsRef,
  highlightReloadTrigger,
}: UsePdfSelectionProps) {
  const [customSelection, setCustomSelection] = useState<{
    start: CustomSelectionPoint;
    end: CustomSelectionPoint;
  } | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [highlightVersion, setHighlightVersion] = useState(0);

  const highlightsRef = useRef<TextHighlight[]>([]);
  const highlightUndoStackRef = useRef<TextHighlight[][]>([]);
  const highlightRedoStackRef = useRef<TextHighlight[][]>([]);

  const isSelectingRef = useRef(false);
  const selectionStartPointRef = useRef<CustomSelectionPoint | null>(null);
  const dragStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollRef = useRef<{ clientY: number } | null>(null);

  const pushHighlightUndoSnapshot = () => {
    highlightUndoStackRef.current = [...highlightUndoStackRef.current.slice(-49), [...highlightsRef.current]];
    highlightRedoStackRef.current = [];
  };

  const persistHighlights = () => {
    // V3: Write to SQLite via IPC (primary), localStorage as fallback
    if (window.electronAPI?.professorSaveAnnotation) {
      for (const h of highlightsRef.current) {
        window.electronAPI.professorSaveAnnotation({
          annotation_id: h.id,
          material_id: materialId,
          page: pageNum,
          type: h.type || 'highlight',
          target_text: h.text,
          color: h.color,
          callout: h.callout || null,
          source: h.source || 'user',
          created_at: new Date(h.createdAt).getTime() || Date.now(),
          stroke_data: h.rects ? JSON.stringify(h.rects) : null,
        });
      }
    } else {
      // Fallback for non-Electron environments
      localStorage.setItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`, JSON.stringify(highlightsRef.current));
    }
  };

  const loadHighlights = useCallback(() => {
    // V3: Load from SQLite first, fall back to localStorage
    if (window.electronAPI?.professorGetAnnotations) {
      window.electronAPI.professorGetAnnotations(materialId, pageNum).then((dbAnnotations: any[]) => {
        // Filter out stroke annotations from highlightsRef
        const dbHighlights = (dbAnnotations || []).filter((a: any) => a.type !== 'stroke');
        if (dbHighlights && dbHighlights.length > 0) {
          highlightsRef.current = dbHighlights.map((a: any) => {
            let rects = [];
            if (a.stroke_data) {
              try {
                rects = JSON.parse(a.stroke_data);
              } catch (e) {
                rects = [];
              }
            }
            return {
              id: a.annotation_id,
              type: a.type || 'highlight',
              color: a.color,
              rects,
              text: a.target_text || '',
              createdAt: new Date(a.created_at).toISOString(),
              source: a.source,
              callout: a.callout,
            };
          });
          // Clean up localStorage keys on successful DB load
          const raw = localStorage.getItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`);
          if (raw) {
            localStorage.removeItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`);
            console.log(`[V3 Cleanup] Cleaned up localStorage highlights for page ${pageNum}`);
          }
        } else {
          // Try localStorage migration
          const raw = localStorage.getItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              highlightsRef.current = parsed;
              // Migrate to SQLite
              for (const h of parsed) {
                window.electronAPI!.professorSaveAnnotation({
                  annotation_id: h.id,
                  material_id: materialId,
                  page: pageNum,
                  type: h.type || 'highlight',
                  target_text: h.text,
                  color: h.color,
                  callout: h.callout || null,
                  source: h.source || 'user',
                  created_at: new Date(h.createdAt).getTime() || Date.now(),
                  stroke_data: h.rects ? JSON.stringify(h.rects) : null,
                });
              }
              console.log(`[V3 Migration] Migrated ${parsed.length} highlights for page ${pageNum} to SQLite`);
              localStorage.removeItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`);
            } catch {
              highlightsRef.current = [];
            }
          } else {
            highlightsRef.current = [];
          }
        }
        setHighlightVersion((v) => v + 1);
      }).catch(() => {
        // IPC failed, fall back to localStorage
        const raw = localStorage.getItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`);
        highlightsRef.current = raw ? JSON.parse(raw) : [];
        setHighlightVersion((v) => v + 1);
      });
    } else {
      const raw = localStorage.getItem(`corvovault-pdf-text-highlights-${materialId}-${pageNum}`);
      if (raw) {
        try { highlightsRef.current = JSON.parse(raw); } catch { highlightsRef.current = []; }
      } else {
        highlightsRef.current = [];
      }
      setHighlightVersion((v) => v + 1);
    }
  }, [materialId, pageNum]);

  useEffect(() => {
    loadHighlights();
  }, [loadHighlights, highlightReloadTrigger]);

  // Clear selections on non-active pages
  useEffect(() => {
    if (activeSelectionPage !== pageNum) {
      setCustomSelection(null);
      setSelectionToolbar(null);
    }
  }, [activeSelectionPage, pageNum]);

  const addTextMark = (type: TextHighlight['type'], color: string) => {
    if (!selectionToolbar) return;
    pushHighlightUndoSnapshot();
    highlightsRef.current = [
      ...highlightsRef.current,
      {
        id: Math.random().toString(36).slice(2, 9),
        type,
        color,
        rects: selectionToolbar.rects,
        text: selectionToolbar.text,
        createdAt: new Date().toISOString(),
      },
    ];
    persistHighlights();
    setHighlightVersion((v) => v + 1);
    setCustomSelection(null);
    setSelectionToolbar(null);
  };

  const addTextHighlight = (color: string) => addTextMark('highlight', color);

  const deleteHighlight = (id: string) => {
    pushHighlightUndoSnapshot();
    highlightsRef.current = highlightsRef.current.filter((x) => x.id !== id);
    if (window.electronAPI?.professorDeleteAnnotation) {
      window.electronAPI.professorDeleteAnnotation(id);
    }
    persistHighlights();
    setHighlightVersion((v) => v + 1);
    setSelectionToolbar(null);
  };

  const copySelectedText = async () => {
    if (!selectionToolbar) return;
    const textToCopy = selectionToolbar.text;

    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        success = true;
      }
    } catch (e) {
      // navigator.clipboard might fail in some Electron contexts
    }

    if (!success) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
    }

    setCustomSelection(null);
    setSelectionToolbar(null);
  };

  // Keyboard shortcut overrides
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);
      if (isTyping) return;

      const key = e.key.toLowerCase();

      if (e.key === 'Escape') {
        setCustomSelection(null);
        setSelectionToolbar(null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectionToolbar && selectionToolbar.existingHighlightId) {
          e.preventDefault();
          deleteHighlight(selectionToolbar.existingHighlightId);
          return;
        }
      }

      if (e.ctrlKey && key === 'c') {
        if (selectionToolbar && selectionToolbar.text && !selectionToolbar.existingHighlightId) {
          e.preventDefault();
          copySelectedText();
          return;
        }
      }

      if (!isDrawMode && e.ctrlKey) {
        if (key === 'z') {
          e.preventDefault();
          const previous = highlightUndoStackRef.current.pop();
          if (!previous) return;
          highlightRedoStackRef.current = [...highlightRedoStackRef.current, [...highlightsRef.current]];
          highlightsRef.current = previous;
          persistHighlights();
          setHighlightVersion((v) => v + 1);
          setSelectionToolbar(null);
        } else if (key === 'y') {
          e.preventDefault();
          const next = highlightRedoStackRef.current.pop();
          if (!next) return;
          highlightUndoStackRef.current = [...highlightUndoStackRef.current, [...highlightsRef.current]];
          highlightsRef.current = next;
          persistHighlights();
          setHighlightVersion((v) => v + 1);
          setSelectionToolbar(null);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isDrawMode, selectionToolbar, pageNum]);

  // Click outside listener
  useEffect(() => {
    if (!selectionToolbar) return;

    const handleGlobalPointerDown = (e: PointerEvent) => {
      const toolbarEl = document.getElementById(`pdf-selection-toolbar-${materialId}-${pageNum}`);
      if (toolbarEl && toolbarEl.contains(e.target as Node)) {
        return;
      }
      setSelectionToolbar(null);
    };

    document.addEventListener('pointerdown', handleGlobalPointerDown);
    return () => document.removeEventListener('pointerdown', handleGlobalPointerDown);
  }, [selectionToolbar, materialId, pageNum]);

  // Clipboard copy listener interceptor
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (activeSelectionPage !== pageNum || !customSelection || processedTextItemsRef.current.length === 0) {
        return;
      }

      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);
      if (isTyping) return;

      const nativeSel = window.getSelection()?.toString();
      if (nativeSel && nativeSel.length > 0) return;

      const selectedText = getCustomSelectionText(
        customSelection.start,
        customSelection.end,
        processedTextItemsRef.current,
        dimensions.w,
        dimensions.h
      );
      if (selectedText) {
        e.clipboardData?.setData('text/plain', selectedText);
        e.preventDefault();
      }
    };
    window.addEventListener('copy', handleCopy);
    return () => window.removeEventListener('copy', handleCopy);
  }, [customSelection, dimensions, activeSelectionPage, pageNum]);

  // Auto-scroll loop
  useEffect(() => {
    const tick = () => {
      autoScrollRafRef.current = null;
      if (!isSelectingRef.current || !scrollContainerEl || !autoScrollRef.current) return;

      const { clientY } = autoScrollRef.current;
      const containerRect = scrollContainerEl.getBoundingClientRect();
      const EDGE_ZONE = 48;
      const MAX_SPEED = 14;

      let delta = 0;
      const distFromTop = clientY - containerRect.top;
      const distFromBottom = containerRect.bottom - clientY;

      if (distFromTop < EDGE_ZONE) {
        delta = -MAX_SPEED * Math.pow(1 - distFromTop / EDGE_ZONE, 1.5);
      } else if (distFromBottom < EDGE_ZONE) {
        delta = MAX_SPEED * Math.pow(1 - distFromBottom / EDGE_ZONE, 1.5);
      }

      if (delta !== 0) {
        scrollContainerEl.scrollBy({ top: delta, behavior: 'instant' } as any);
      }

      if (isSelectingRef.current) {
        autoScrollRafRef.current = requestAnimationFrame(tick);
      }
    };

    return () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [scrollContainerEl]);

  // Global mouse move and up listeners
  const handleGlobalMouseMove = useCallback(
    (e: MouseEvent, rect: DOMRect) => {
      if (!isSelectingRef.current || !selectionStartPointRef.current) return;

      autoScrollRef.current = { clientY: e.clientY };
      if (autoScrollRafRef.current === null && scrollContainerEl) {
        autoScrollRafRef.current = requestAnimationFrame(() => {
          autoScrollRafRef.current = null;
          if (!isSelectingRef.current || !scrollContainerEl || !autoScrollRef.current) return;
          const { clientY } = autoScrollRef.current;
          const containerRect = scrollContainerEl.getBoundingClientRect();
          const EDGE_ZONE = 48;
          const MAX_SPEED = 14;
          let delta = 0;
          const distFromTop = clientY - containerRect.top;
          const distFromBottom = containerRect.bottom - clientY;
          if (distFromTop < EDGE_ZONE) {
            delta = -MAX_SPEED * Math.pow(1 - distFromTop / EDGE_ZONE, 1.5);
          } else if (distFromBottom < EDGE_ZONE) {
            delta = MAX_SPEED * Math.pow(1 - distFromBottom / EDGE_ZONE, 1.5);
          }
          if (delta !== 0) scrollContainerEl.scrollBy({ top: delta, behavior: 'instant' } as any);
        });
      }

      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;

      const dc = dragStartClientRef.current;
      if (dc) {
        const dx = e.clientX - dc.x;
        const dy = e.clientY - dc.y;
        if (Math.sqrt(dx * dx + dy * dy) < 4) return;
      }

      const clampedX = Math.max(0, Math.min(dimensions.w, rawX));
      const clampedY = Math.max(0, Math.min(dimensions.h, rawY));

      const endPoint = findSelectionPoint(clampedX, clampedY, processedTextItemsRef.current, true, dimensions.w, dimensions.h);
      if (endPoint) {
        setCustomSelection({
          start: selectionStartPointRef.current,
          end: endPoint,
        });
      }
    },
    [dimensions, scrollContainerEl]
  );

  const handleGlobalMouseUp = useCallback(
    (pageRect: DOMRect) => {
      if (!isSelectingRef.current) return;
      isSelectingRef.current = false;
      selectionStartPointRef.current = null;
      dragStartClientRef.current = null;
      autoScrollRef.current = null;
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      onSelectionActiveChange?.(false);

      if (customSelection) {
        const text = getCustomSelectionText(customSelection.start, customSelection.end, processedTextItemsRef.current, dimensions.w, dimensions.h);
        const rects = getCustomSelectionRects(customSelection, processedTextItemsRef.current, dimensions.w, dimensions.h);

        if (text && rects.length > 0) {
          if (
            customSelection.start.itemIndex === customSelection.end.itemIndex &&
            customSelection.start.charIndex === customSelection.end.charIndex
          ) {
            setCustomSelection(null);
            setSelectionToolbar(null);
            return;
          }

          const firstRect = rects[0];
          const lastRect = rects[rects.length - 1];
          const posX = Math.max(8, Math.min(pageRect.width - 160, firstRect.x * pageRect.width));

          const TOOLBAR_H = 40;
          const topLimit = TOOLBAR_H + 12;
          const rawToolbarY = firstRect.y * pageRect.height - TOOLBAR_H - 4;
          const bottomOverflow = rawToolbarY + TOOLBAR_H > pageRect.height;
          const posY =
            rawToolbarY < topLimit
              ? (lastRect.y + lastRect.h) * pageRect.height + 8
              : bottomOverflow
              ? Math.max(8, firstRect.y * pageRect.height - TOOLBAR_H - 4)
              : rawToolbarY;

          setSelectionToolbar({
            x: posX,
            y: posY,
            text,
            rects,
          });
        } else {
          setCustomSelection(null);
          setSelectionToolbar(null);
        }
      }
    },
    [customSelection, dimensions, onSelectionActiveChange]
  );

  const handlePageMouseDown = (e: React.MouseEvent<HTMLDivElement>, pageWrapperEl: HTMLDivElement | null) => {
    if (isDrawMode) return;

    const target = e.target as HTMLElement;
    if (!target) return;

    const isToolbar = target.closest(`[id^="pdf-selection-toolbar-"]`);
    if (isToolbar) return;

    clickCountRef.current += 1;
    if (clickTimerRef.current !== null) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 400);

    setCustomSelection(null);
    setSelectionToolbar(null);

    const rect = pageWrapperEl?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const clickX = mouseX / rect.width;
      const clickY = mouseY / rect.height;

      const hitHighlight = highlightsRef.current.find((h) =>
        h.rects.some(
          (r) => clickX >= r.x && clickX <= r.x + r.w && clickY >= r.y && clickY <= r.y + r.h
        )
      );

      if (hitHighlight) {
        const posX = Math.max(8, Math.min(rect.width - 160, mouseX - 40));
        const posY = Math.max(8, mouseY - 44);
        setActiveSelectionPage(pageNum);
        setSelectionToolbar({
          x: posX,
          y: posY,
          text: hitHighlight.text,
          rects: hitHighlight.rects,
          existingHighlightId: hitHighlight.id,
        });
        return;
      }

      if (clickCountRef.current >= 3) {
        clickCountRef.current = 0;
        const point = findSelectionPoint(mouseX, mouseY, processedTextItemsRef.current, false, dimensions.w, dimensions.h);
        if (point) {
          e.preventDefault();
          const items = processedTextItemsRef.current;
          const clickedLineGroup = (items[point.itemIndex] as any).lineGroupId;

          const lineItems = items
            .map((it, idx) => ({ it, idx }))
            .filter(({ it }) => (it as any).lineGroupId === clickedLineGroup);
          if (lineItems.length > 0) {
            const firstIdx = lineItems[0].idx;
            const lastIdx = lineItems[lineItems.length - 1].idx;
            const lineSelection = {
              start: { itemIndex: firstIdx, charIndex: 0 },
              end: { itemIndex: lastIdx, charIndex: items[lastIdx].item.str.length },
            };
            setActiveSelectionPage(pageNum);
            setCustomSelection(lineSelection);
            const rects = getCustomSelectionRects(lineSelection, items, dimensions.w, dimensions.h);
            const firstRect = rects[0];
            if (firstRect) {
              const lineText = getCustomSelectionText(lineSelection.start, lineSelection.end, items, dimensions.w, dimensions.h);
              const TOOLBAR_H = 40;
              const posX = Math.max(8, Math.min(rect.width - 160, firstRect.x * rect.width));
              const rawY = firstRect.y * rect.height - TOOLBAR_H - 4;
              const posY =
                rawY < TOOLBAR_H ? (rects[rects.length - 1].y + rects[rects.length - 1].h) * rect.height + 8 : rawY;
              setSelectionToolbar({ x: posX, y: posY, text: lineText, rects });
            }
          }
        }
        return;
      }

      const startPoint = findSelectionPoint(mouseX, mouseY, processedTextItemsRef.current, false, dimensions.w, dimensions.h);
      if (startPoint) {
        e.preventDefault();
        setActiveSelectionPage(pageNum);
        selectionStartPointRef.current = startPoint;
        dragStartClientRef.current = { x: e.clientX, y: e.clientY };
        isSelectingRef.current = true;
        onSelectionActiveChange?.(true);
        window.getSelection()?.removeAllRanges();
      }
    }
  };

  const handlePageDoubleClick = (e: React.MouseEvent<HTMLDivElement>, pageWrapperEl: HTMLDivElement | null) => {
    if (isDrawMode) return;
    const rect = pageWrapperEl?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const point = findSelectionPoint(mouseX, mouseY, processedTextItemsRef.current, false, dimensions.w, dimensions.h);
    if (point) {
      e.preventDefault();
      const item = processedTextItemsRef.current[point.itemIndex];
      const str = item.item.str;
      const { start, end } = findWordBoundaries(str, point.charIndex);

      const nextSelection = {
        start: { itemIndex: point.itemIndex, charIndex: start },
        end: { itemIndex: point.itemIndex, charIndex: end },
      };
      setActiveSelectionPage(pageNum);
      setCustomSelection(nextSelection);

      // Select span text natively
      try {
        const textLayer = pageWrapperEl?.querySelector('.pdf-text-layer') as HTMLDivElement | null;
        if (textLayer && textLayer.children[point.itemIndex]) {
          const spanNode = textLayer.children[point.itemIndex];
          const textNode = spanNode.firstChild;
          if (textNode) {
            const range = document.createRange();
            range.setStart(textNode, start);
            range.setEnd(textNode, end);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      } catch (err) {
        console.warn('Native selection sync failed', err);
      }

      const selectionRects = getCustomSelectionRects(nextSelection, processedTextItemsRef.current, dimensions.w, dimensions.h);
      const firstRect = selectionRects[0];
      if (firstRect) {
        const selectedText = str.slice(start, end);
        const posX = Math.max(8, Math.min(rect.width - 160, firstRect.x * rect.width));
        const posY = Math.max(8, firstRect.y * rect.height - 44);
        setSelectionToolbar({
          x: posX,
          y: posY,
          text: selectedText,
          rects: selectionRects,
        });
      }
    }
  };

  // Wire up document listeners inside page boundary
  useEffect(() => {
    const handleGlobalMouseMoveWrapped = (e: MouseEvent) => {
      const container = document.getElementById(`pdf-page-wrapper-${materialId}-${pageNum}`);
      const rect = container?.getBoundingClientRect();
      if (rect) handleGlobalMouseMove(e, rect);
    };

    const handleGlobalMouseUpWrapped = () => {
      const container = document.getElementById(`pdf-page-wrapper-${materialId}-${pageNum}`);
      const rect = container?.getBoundingClientRect();
      if (rect) handleGlobalMouseUp(rect);
    };

    window.addEventListener('mousemove', handleGlobalMouseMoveWrapped);
    window.addEventListener('mouseup', handleGlobalMouseUpWrapped);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMoveWrapped);
      window.removeEventListener('mouseup', handleGlobalMouseUpWrapped);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp, materialId, pageNum]);

  // Notify parent toolbar state active change
  useEffect(() => {
    onSelectionActiveChange?.(!!selectionToolbar);
  }, [selectionToolbar, onSelectionActiveChange]);

  return {
    customSelection,
    setCustomSelection,
    selectionToolbar,
    setSelectionToolbar,
    highlights: highlightsRef.current,
    highlightVersion,
    addTextHighlight,
    addTextMark,
    deleteHighlight,
    copySelectedText,
    handlePageMouseDown,
    handlePageDoubleClick,
  };
}
