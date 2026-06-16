import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Trash2,
  BookOpen,
  Bookmark,
  Sparkles,
  Highlighter,
  Eraser,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  Eye,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  HelpCircle,
  X,
  Undo2,
  Redo2,
  Copy,
  Underline,
  Strikethrough,
  Send,
  Presentation,
} from 'lucide-react';
import { Material, ProfessorSession, BoardAction, PdfAnnotation, ProfessorResponse } from '../../types';
import { useUserSettings } from '../../hooks/useLocalData';
import { generateAIResponse, generateProfessorResponse, ChatMessage } from '../../lib/ai';
import BlackboardCanvas, { BlackboardCanvasHandle } from './BlackboardCanvas';
import { usePdfDocument, OutlineItem } from '../../hooks/usePdfDocument';
import { usePdfBookmarks, StudyBookmark } from '../../hooks/usePdfBookmarks';
import { useProfessorSession } from '../../hooks/useProfessorSession';
import { useIngestionStatus } from '../../hooks/useIngestionStatus';
import { usePdfAnnotations, AnnotationCommand } from '../../hooks/usePdfAnnotations';
import AiTutorPanel from './AiTutorPanel';
import PdfToolbar from './PdfToolbar';
import PdfSidebar from './PdfSidebar';
import { usePdfSelection, TextHighlight, SelectionToolbarState } from '../../hooks/usePdfSelection';
import SelectionToolbar from './SelectionToolbar';
import {
  ProcessedTextItem,
  CustomSelectionPoint,
  getCustomSelectionRects,
  detectAndAssignColumns,
  ensureProfile,
  profileCache
} from '../../lib/pdfSelectionEngine';
import { findFuzzyTargetItem } from '../../lib/highlightMatcher';

interface CustomPdfViewerProps {
  material: Material;
  pdfPath?: string;
  getFileSrc: (path: string | undefined | null) => string;
  isNotesCollapsed?: boolean;
  setIsNotesCollapsed?: (collapsed: boolean) => void;
}

// Interfaces imported from hooks

interface DrawingStroke {
  id: string;
  type: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

// AnnotationCommand imported from hooks

// PDFJS Loader is now handled inside usePdfDocument hook

// Expands PDF ligature code-points to ASCII equivalents so that the
// normalised substring match works even when the PDF encodes "fi", "fl", etc.
// as single Unicode glyphs (U+FB00–U+FB06) and the LLM writes natural ASCII.
function expandPdfLigaturesCV(str: string): string {
  return str
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'st')
    .replace(/\uFB06/g, 'st')
    .replace(/\u00AD/g, ''); // soft hyphen
}

// Token-based Jaccard similarity — replaces the old prefix-only comparison
// with a robust word-overlap metric used in the single-item fallback path.
function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokA) { if (tokB.has(t)) intersection++; }
  return intersection / (tokA.size + tokB.size - intersection); // Jaccard index
}

// Dynamically compute coordinates on-the-fly for database highlights that lack rects
function findRectsForTextCV(
  targetText: string,
  processedItems: ProcessedTextItem[],
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; w: number; h: number }[] {
  if (!targetText || processedItems.length === 0) return [];

  let rects: { x: number; y: number; w: number; h: number }[] = [];
  
  let concatText = '';
  const charMap: { itemIndex: number; charIndex: number }[] = [];

  processedItems.forEach((item, itemIdx) => {
    const str = item.item.str || '';
    for (let charIdx = 0; charIdx < str.length; charIdx++) {
      concatText += str[charIdx];
      charMap.push({ itemIndex: itemIdx, charIndex: charIdx });
    }
  });

  const normalToOriginal: number[] = [];
  let normalizedConcat = '';
  for (let i = 0; i < concatText.length; i++) {
    const ch = concatText[i];
    // Expand ligatures
    const expanded = ch === '\uFB00' ? 'ff' :
                     ch === '\uFB01' ? 'fi' :
                     ch === '\uFB02' ? 'fl' :
                     ch === '\uFB03' ? 'ffi' :
                     ch === '\uFB04' ? 'ffl' :
                     ch === '\uFB05' ? 'st' :
                     ch === '\uFB06' ? 'st' :
                     ch === '\u00AD' ? '' : ch;
    for (const ec of expanded) {
      const lower = ec.toLowerCase();
      if (/[a-z0-9]/.test(lower)) {
        normalizedConcat += lower;
        normalToOriginal.push(i);
      }
    }
  }

  const normalizedTarget = expandPdfLigaturesCV(targetText).toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchIdx = normalizedConcat.indexOf(normalizedTarget);

  if (matchIdx !== -1 && normalizedTarget.length > 0) {
    const startConcatIdx = normalToOriginal[matchIdx];
    const endConcatIdx = normalToOriginal[matchIdx + normalizedTarget.length - 1] + 1;
    
    const startPoint = charMap[startConcatIdx];
    const endPoint = endConcatIdx < charMap.length 
      ? charMap[endConcatIdx] 
      : { itemIndex: processedItems.length - 1, charIndex: processedItems[processedItems.length - 1].item.str.length };

    if (startPoint && endPoint) {
      rects = getCustomSelectionRects(
        { start: startPoint, end: endPoint },
        processedItems,
        pageWidth,
        pageHeight
      );
    }
  }

  // Try sliding window word-level fuzzy matching
  const targetWords = targetText.split(/\s+/).filter(Boolean);
  if (rects.length === 0 && targetWords.length > 0) {
    const words: { text: string; startIdx: number; endIdx: number }[] = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(concatText)) !== null) {
      words.push({
        text: match[0],
        startIdx: match.index,
        endIdx: match.index + match[0].length
      });
    }

    if (words.length > 0) {
      const windowSize = Math.min(targetWords.length, words.length);
      let bestWindowIdx = -1;
      let bestWindowScore = 0;

      for (let i = 0; i <= words.length - windowSize; i++) {
        let score = 0;
        for (let j = 0; j < windowSize; j++) {
          const wordA = words[i + j].text.toLowerCase().replace(/[^a-z0-9]/g, '');
          const wordB = targetWords[j].toLowerCase().replace(/[^a-z0-9]/g, '');
          if (wordA === wordB) {
            score += 1.0;
          } else if (wordA && wordB && (wordA.includes(wordB) || wordB.includes(wordA))) {
            score += 0.5;
          }
        }
        const normScore = score / windowSize;
        if (normScore > bestWindowScore) {
          bestWindowScore = normScore;
          bestWindowIdx = i;
        }
      }

      if (bestWindowIdx !== -1 && bestWindowScore >= 0.5) {
        const startConcatIdx = words[bestWindowIdx].startIdx;
        const endConcatIdx = words[bestWindowIdx + windowSize - 1].endIdx;

        const startPoint = charMap[startConcatIdx];
        const endPoint = endConcatIdx < charMap.length 
          ? charMap[endConcatIdx] 
          : { itemIndex: processedItems.length - 1, charIndex: processedItems[processedItems.length - 1].item.str.length };

        if (startPoint && endPoint) {
          rects = getCustomSelectionRects(
            { start: startPoint, end: endPoint },
            processedItems,
            pageWidth,
            pageHeight
          );
        }
      }
    }
  }

  // Tier 4: Fuse.js fuzzy fallback — fires when tiers 1–3 all fail.
  // Handles ligature differences, hyphenation, and minor LLM text variations.
  if (rects.length === 0 && targetText.length >= 6) {
    const fuseItems = processedItems.map(item => ({ str: item.item?.str || '' }));
    const match = findFuzzyTargetItem(targetText, fuseItems, 0.35);
    if (match) {
      // Build rects from the matched item span
      const startPoint: CustomSelectionPoint = { itemIndex: match.startIndex, charIndex: 0 };
      const endItem = processedItems[match.endIndex];
      const endPoint: CustomSelectionPoint = {
        itemIndex: match.endIndex,
        charIndex: endItem?.item?.str?.length ?? 0,
      };
      const fuzzyRects = getCustomSelectionRects({ start: startPoint, end: endPoint }, processedItems, pageWidth, pageHeight);
      if (fuzzyRects.length > 0) {
        rects = fuzzyRects;
      }
    }
  }

  return rects;
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function CustomPdfViewer({
  material,
  pdfPath,
  getFileSrc,
  isNotesCollapsed,
  setIsNotesCollapsed,
}: CustomPdfViewerProps) {
  const { settings } = useUserSettings();
  const geminiKey = settings?.geminiKey || '';
  const openrouterKey = settings?.openrouterKey || '';
  const openaiKey = settings?.openaiKey || '';
  const anthropicKey = settings?.anthropicKey || '';
  const selectedModel = settings?.selectedModel || 'gemini';
  const activePdfPath = pdfPath || material.localPath || material.url;

  // PDF state from hook
  const {
    pdfjsLoaded,
    pdfjsError,
    pdfDoc,
    numPages,
    loadingDoc,
    outline
  } = usePdfDocument(activePdfPath, getFileSrc);

  const [currentPage, setCurrentPage] = useState(1);

  // Sync page state back to page 1 on document path change
  useEffect(() => {
    setCurrentPage(1);
  }, [activePdfPath]);

  // View state
  const [zoom, setZoom] = useState(1.2);
  const [rotation, setRotation] = useState(0);
  const [readingFilter, setReadingFilter] = useState<'default' | 'sepia' | 'dark'>('default');
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'thumbnails' | 'bookmarks'>('thumbnails');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Draw state from hook
  const {
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
    drawTriggerCount,
    setDrawTriggerCount,
    annotationCommand,
    setAnnotationCommand,
    clearPageAnnotations,
    runAnnotationCommand
  } = usePdfAnnotations(material.id, currentPage);
  const [activeSelectionPage, setActiveSelectionPage] = useState<number | null>(null);

  // AI state
  const [isAiPaneOpen, setIsAiPaneOpen] = useState(false);

  // Professor session state managed by custom hook
  const { professorSession, setProfessorSession } = useProfessorSession(
    material.id,
    currentPage,
    (page) => jumpToPage(page)
  );

  const ingestionStatus = useIngestionStatus(material.id);

  // Notes state mapped to props/defaults
  const notesCollapsed = isNotesCollapsed ?? true;
  const setNotesCollapsed = setIsNotesCollapsed ?? (() => {});

  // Professor Annotations and Blackboard States
  const [professorAnnotations, setProfessorAnnotations] = useState<PdfAnnotation[]>([]);
  const [highlightReloadTrigger, setHighlightReloadTrigger] = useState(0);
  const [isBlackboardOpen, setIsBlackboardOpen] = useState(false);
  const [isBlackboardFullScreen, setIsBlackboardFullScreen] = useState(false);
  const [boardActionQueue, setBoardActionQueue] = useState<BoardAction[]>([]);
  const blackboardRef = useRef<BlackboardCanvasHandle>(null);

  // Enforce panel management logic (Only one right-side panel open at a time)
  const handleSetAiPaneOpen = (open: boolean) => {
    setIsAiPaneOpen(open);
    if (open) {
      setIsSidebarOpen(false);
      setNotesCollapsed(true);
      setIsBlackboardOpen(false);
      setIsBlackboardFullScreen(false);
    }
  };

  const handleSetBlackboardOpen = (open: boolean) => {
    setIsBlackboardOpen(open);
    if (!open) {
      setIsBlackboardFullScreen(false);
    }
    if (open) {
      setIsSidebarOpen(false);
      setIsAiPaneOpen(false);
      setNotesCollapsed(true);
    }
  };

  const handleSetSidebarOpen = (open: boolean) => {
    setIsSidebarOpen(open);
    if (open) {
      setIsAiPaneOpen(false);
      setNotesCollapsed(true);
      setIsBlackboardOpen(false);
      setIsBlackboardFullScreen(false);
    }
  };

  // Enforce panel rules when notes are toggled manually from the parent
  useEffect(() => {
    if (!notesCollapsed) {
      setIsSidebarOpen(false);
      setIsAiPaneOpen(false);
      setIsBlackboardOpen(false);
      setIsBlackboardFullScreen(false);
    }
  }, [notesCollapsed]);

  // Determine active workspace mode dynamically
  const getActiveWorkspaceMode = (): 'read' | 'study' | 'research' | 'deep' | 'blackboard' | 'custom' => {
    const isNotesOpen = !notesCollapsed;
    
    if (isSidebarOpen && !isAiPaneOpen && !isNotesOpen && !isBlackboardOpen) {
      return 'read';
    }
    if (!isSidebarOpen && isAiPaneOpen && !isNotesOpen && !isBlackboardOpen) {
      return 'study';
    }
    if (!isSidebarOpen && !isAiPaneOpen && isNotesOpen && !isBlackboardOpen) {
      return 'research';
    }
    if (!isSidebarOpen && !isAiPaneOpen && !isNotesOpen && isBlackboardOpen) {
      return 'blackboard';
    }
    if (!isSidebarOpen && !isAiPaneOpen && !isNotesOpen && !isBlackboardOpen) {
      return 'deep';
    }
    return 'custom';
  };

  const handleSetWorkspaceMode = (mode: 'read' | 'study' | 'research' | 'deep' | 'blackboard') => {
    setIsBlackboardFullScreen(false); // Reset on mode change
    switch (mode) {
      case 'read':
        handleSetSidebarOpen(true);
        break;
      case 'study':
        handleSetAiPaneOpen(true);
        break;
      case 'research':
        setIsSidebarOpen(false);
        setIsAiPaneOpen(false);
        setNotesCollapsed(false);
        setIsBlackboardOpen(false);
        break;
      case 'deep':
        setIsSidebarOpen(false);
        setIsAiPaneOpen(false);
        setNotesCollapsed(true);
        setIsBlackboardOpen(false);
        break;
      case 'blackboard':
        handleSetBlackboardOpen(true);
        break;
    }
  };
  
  const enqueueBoardActions = (actions: BoardAction[]) => {
    if (!isBlackboardOpen) handleSetBlackboardOpen(true);
    setBoardActionQueue(prev => [...prev, ...actions]);
  };

  useEffect(() => {
    if (professorAnnotations.length === 0 || !pdfDoc) return;

    const process = async () => {
      for (const annotation of professorAnnotations) {
        try {
          const page = await pdfDoc.getPage(annotation.page);
          const tc = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          const items = tc.items as any[];

          const pdfjsLib = (window as any).pdfjsLib;
          const util = pdfjsLib?.Util;
          const processedItems = items
            .map(item => {
              if (!item?.str) return null;

              const transform = util?.transform
                ? util.transform(viewport.transform, item.transform)
                : multiplyTransforms(viewport.transform, item.transform);

              const fontHeight = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || 10;
              const angle = Math.atan2(transform[1], transform[0]);
              const left = transform[4];
              const top = transform[5] - fontHeight;
              const visualTop = transform[5] - fontHeight * 0.82;
              const width = Math.max(8, (item.width || item.str.length * fontHeight * 0.55) * viewport.scale);
              const fontName = item.fontName;
              const style = tc.styles?.[fontName];
              const fontFamily = style?.fontFamily || 'sans-serif';

              return {
                item,
                transform,
                fontHeight,
                angle,
                left,
                top,
                visualTop,
                width,
                fontFamily,
              };
            })
            .filter(Boolean) as any[];

          // Row-based sorting to match DOM ordering
          const sortedFH = processedItems.map((i: any) => i.fontHeight).sort((a: number, b: number) => a - b);
          const medFH: number = sortedFH.length > 0 ? sortedFH[Math.floor(sortedFH.length / 2)] : 12;
          const rowBucket: number = Math.max(4, medFH * 0.65);

          processedItems.forEach((item: any) => {
            item._rowKey = Math.round(item.top / rowBucket);
          });

          processedItems.sort((a: any, b: any) => {
            if (a._rowKey !== b._rowKey) return a._rowKey - b._rowKey;
            return a.left - b.left;
          });

          processedItems.forEach((item: any) => { delete item._rowKey; });

          // Try multi-line/span exact/fuzzy matching
          let rects: { x: number; y: number; w: number; h: number }[] = [];
          
          let concatText = '';
          const charMap: { itemIndex: number; charIndex: number }[] = [];

          processedItems.forEach((item, itemIdx) => {
            // Use the ORIGINAL item string so charIndex in charMap always refers
            // to the original str. Ligature expansion happens during normalization
            // (below) without shifting any positions.
            const str = item.item.str || '';
            for (let charIdx = 0; charIdx < str.length; charIdx++) {
              concatText += str[charIdx];
              charMap.push({ itemIndex: itemIdx, charIndex: charIdx });
            }
          });

          // Normalize for mapping — expand PDF ligature glyphs INLINE so
          // ﬁ/ﬂ/ﬀ etc. map to their ASCII equivalents without shifting the
          // charMap positions (all expanded chars point to the same original i).
          const LIGATURE_MAP: Record<string, string> = {
            '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl',
            '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st',
            '\u00AD': '', // soft hyphen — expand to nothing
          };
          const normalToOriginal: number[] = [];
          let normalizedConcat = '';
          for (let i = 0; i < concatText.length; i++) {
            const ch = concatText[i];
            const expanded = LIGATURE_MAP[ch] ?? ch; // expand or passthrough
            for (const ec of expanded) {
              const lower = ec.toLowerCase();
              if (/[a-z0-9]/.test(lower)) {
                normalizedConcat += lower;
                normalToOriginal.push(i); // ALL expanded chars → same original pos
              }
            }
          }

          const normalizedTarget = expandPdfLigaturesCV(annotation.targetText).toLowerCase().replace(/[^a-z0-9]/g, '');
          const matchIdx = normalizedConcat.indexOf(normalizedTarget);

          if (matchIdx !== -1 && normalizedTarget.length > 0) {
            const startConcatIdx = normalToOriginal[matchIdx];
            const endConcatIdx = normalToOriginal[matchIdx + normalizedTarget.length - 1] + 1;
            
            const startPoint = charMap[startConcatIdx];
            const endPoint = endConcatIdx < charMap.length 
              ? charMap[endConcatIdx] 
              : { itemIndex: processedItems.length - 1, charIndex: processedItems[processedItems.length - 1].item.str.length };

            if (startPoint && endPoint) {
              rects = getCustomSelectionRects(
                { start: startPoint, end: endPoint },
                processedItems,
                viewport.width,
                viewport.height
              );
            }
          }

          // Try sliding window word-level fuzzy matching
          const targetWords = annotation.targetText.split(/\s+/).filter(Boolean);
          if (rects.length === 0 && targetWords.length > 0) {
            const words: { text: string; startIdx: number; endIdx: number }[] = [];
            const regex = /\S+/g;
            let match;
            while ((match = regex.exec(concatText)) !== null) {
              words.push({
                text: match[0],
                startIdx: match.index,
                endIdx: match.index + match[0].length
              });
            }

            if (words.length > 0) {
              const windowSize = Math.min(targetWords.length, words.length);
              let bestWindowIdx = -1;
              let bestWindowScore = 0;

              for (let i = 0; i <= words.length - windowSize; i++) {
                let score = 0;
                for (let j = 0; j < windowSize; j++) {
                  const wordA = words[i + j].text.toLowerCase().replace(/[^a-z0-9]/g, '');
                  const wordB = targetWords[j].toLowerCase().replace(/[^a-z0-9]/g, '');
                  if (wordA === wordB) {
                    score += 1.0;
                  } else if (wordA && wordB && (wordA.includes(wordB) || wordB.includes(wordA))) {
                    score += 0.5;
                  }
                }
                const normScore = score / windowSize;
                if (normScore > bestWindowScore) {
                  bestWindowScore = normScore;
                  bestWindowIdx = i;
                }
              }

              if (bestWindowIdx !== -1 && bestWindowScore >= 0.5) {
                const startConcatIdx = words[bestWindowIdx].startIdx;
                const endConcatIdx = words[bestWindowIdx + windowSize - 1].endIdx;

                const startPoint = charMap[startConcatIdx];
                const endPoint = endConcatIdx < charMap.length 
                  ? charMap[endConcatIdx] 
                  : { itemIndex: processedItems.length - 1, charIndex: processedItems[processedItems.length - 1].item.str.length };

                if (startPoint && endPoint) {
                  rects = getCustomSelectionRects(
                    { start: startPoint, end: endPoint },
                    processedItems,
                    viewport.width,
                    viewport.height
                  );
                }
              }
            }
          }

          // Fallback if no multi-line span found (e.g. text got heavily altered or is short)
          if (rects.length === 0) {
            const targetLower = annotation.targetText.toLowerCase().slice(0, 60);
            let bestItem: any = null;
            let bestScore = 0;

            for (const item of processedItems) {
              const str = item.item.str;
              if (!str?.trim()) continue;
              const itemLower = str.toLowerCase();
              const score = itemLower.includes(targetLower) ? 1 :
                targetLower.includes(itemLower) ? 0.6 :
                levenshteinSimilarity(itemLower, targetLower);
              if (score > bestScore) { bestScore = score; bestItem = item; }
            }

            if (bestItem && bestScore >= 0.3) {
              const bbox = {
                x: bestItem.left / viewport.width,
                y: bestItem.top / viewport.height,
                w: bestItem.width / viewport.width,
                h: bestItem.fontHeight / viewport.height,
              };
              rects = [bbox];
            }
          }

          if (rects.length === 0) continue;

          const hl: TextHighlight = {
            id: `prof-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: annotation.type === 'circle' ? 'highlight' : (annotation.type as any),
            color: annotation.color || 'orange',
            rects: rects,
            text: annotation.targetText,
            createdAt: new Date().toISOString(),
            source: 'professor',
            callout: annotation.callout,
            targetPage: annotation.page,
          };

          // Load existing highlights for that page, push new one, and save back to localStorage
          const raw = localStorage.getItem(`corvovault-pdf-text-highlights-${material.id}-${annotation.page}`);
          let currentHighlights: TextHighlight[] = [];
          if (raw) {
            try { currentHighlights = JSON.parse(raw); } catch {}
          }
          currentHighlights.push(hl);
          localStorage.setItem(`corvovault-pdf-text-highlights-${material.id}-${annotation.page}`, JSON.stringify(currentHighlights));

        } catch (e) {
          console.warn('[Professor] Annotation failed for page', annotation.page, e);
        }
      }
      
      // Trigger reload in all page items
      setHighlightReloadTrigger(v => v + 1);
      setProfessorAnnotations([]);
    };

    process();
  }, [professorAnnotations, pdfDoc, material.id]);



  const renderStyledText = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, lineIdx) => {
      const inlineRegex = /(\*\*[^*]+\*\*|\b[pP]age\s+\d+\b)/g;
      const parts = line.split(inlineRegex);
      const renderedLine = parts.map((part, partIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const boldText = part.slice(2, -2);
          return <strong key={partIdx} className="font-semibold text-on-surface">{boldText}</strong>;
        }
        
        const pageMatch = part.match(/\b[pP]age\s+(\d+)\b/i);
        if (pageMatch) {
          const pageNum = parseInt(pageMatch[1], 10);
          return (
            <button
              key={partIdx}
              onClick={() => {
                if (pageNum >= 1 && pageNum <= numPages) {
                  jumpToPage(pageNum);
                }
              }}
              className="text-primary hover:underline font-bold inline-block mx-0.5 align-baseline cursor-pointer"
            >
              {part}
            </button>
          );
        }
        
        return part;
      });

      return (
        <div key={lineIdx} className={line.trim() ? 'min-h-[1.2em]' : 'h-3'}>
          {renderedLine}
        </div>
      );
    });
  };

  // Bookmarks state from hook
  const {
    studyBookmarks,
    newBookmarkLabel,
    setNewBookmarkLabel,
    handleAddBookmark,
    handleDeleteBookmark
  } = usePdfBookmarks(material.id);

  // Callback ref keeps scroll tracking attached to the actual reader element.
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollRoot(node);
  }, []);
  const [sidebarScrollRoot, setSidebarScrollRoot] = useState<HTMLDivElement | null>(null);
  const sidebarScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setSidebarScrollRoot(node);
  }, []);

  // ── Jump Active Lock to prevent scroll conflict ──────────────────────────
  const isJumpingRef = useRef(false);
  const jumpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // programmatic scroll target (in scrollRoot.scrollTop coordinates)
  const jumpTargetRef = useRef<number | null>(null);
  // When a page is actively being text-selected, suppress automatic
  // viewport-driven page changes to avoid accidental jumps.
  const isUserSelectingRef = useRef(false);
  const PDF_DEBUG = Boolean((window as any).__SIC_PDF_DEBUG);

  // ── Scroll Active Page Tracking ──────────────────────────────────────────
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    if (!scrollRoot || numPages === 0) return;

    const handleScroll = () => {
      // If we are programmatically jumping, ignore intermediate scroll events
      if (isJumpingRef.current) {
        if (jumpTargetRef.current != null) {
          const currentTop = scrollRoot.scrollTop;
          if (Math.abs(currentTop - jumpTargetRef.current) <= 2) {
            isJumpingRef.current = false;
            if (jumpTimeoutRef.current) {
              clearTimeout(jumpTimeoutRef.current);
              jumpTimeoutRef.current = null;
            }
            jumpTargetRef.current = null;
          } else {
            return; // still animating toward programmatic target
          }
        } else {
          return;
        }
      }

      // If the user is actively selecting text, avoid updating current page
      // from scroll events — this prevents accidental jumps while dragging.
      if (isUserSelectingRef.current) return;

      const containerRect = scrollRoot.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let bestPage = currentPageRef.current;
      let minDistance = Infinity;

      for (let i = 1; i <= numPages; i++) {
        const el = document.getElementById(`pdf-page-wrapper-${material.id}-${i}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const pageCenter = rect.top + rect.height / 2;
          const distance = Math.abs(pageCenter - containerCenter);
          if (distance < minDistance) {
            minDistance = distance;
            bestPage = i;
          }
        }
      }

      if (bestPage !== currentPageRef.current) {
        if (PDF_DEBUG) console.debug('pdf viewer: handleScroll setCurrentPage', { bestPage, current: currentPageRef.current });
        setCurrentPage(bestPage);
      }
    };

    let frameId: number | null = null;
    const onScroll = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        handleScroll();
        frameId = null;
      });
    };

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    
    // Run initially to sync with current viewport
    handleScroll();

    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [scrollRoot, numPages]);





  // ── Jump to page ─────────────────────────────────────────────────────────
  const jumpToPage = useCallback((pageNum: number) => {
    if (pageNum < 1 || pageNum > numPages) return;
    setCurrentPage(pageNum);
    setActiveSelectionPage(null); // Clear any floating selection on programmatic page jump
    const el = document.getElementById(`pdf-page-wrapper-${material.id}-${pageNum}`);
    if (el && scrollRoot) {
      // Mark programmatic jump and record target scrollTop so the scroll handler
      // can ignore intermediate events until we've arrived (more robust than a fixed timeout).
      isJumpingRef.current = true;
      if (jumpTimeoutRef.current) {
        clearTimeout(jumpTimeoutRef.current);
        jumpTimeoutRef.current = null;
      }

      const elRect = el.getBoundingClientRect();
      const containerRect = scrollRoot.getBoundingClientRect();
      const scrollTo = Math.max(0, scrollRoot.scrollTop + (elRect.top - containerRect.top) - 16);
      jumpTargetRef.current = scrollTo;

      // Safety timeout in case smooth scroll doesn't finish for any reason
      jumpTimeoutRef.current = setTimeout(() => {
        isJumpingRef.current = false;
        jumpTargetRef.current = null;
        jumpTimeoutRef.current = null;
      }, 1500);

      scrollRoot.scrollTo({ top: scrollTo, behavior: 'smooth' });
    } else if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [numPages, scrollRoot, material.id, setActiveSelectionPage]);







  // ─── LOADING / ERROR STATES ──────────────────────────────────────────────
  if (pdfjsError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-on-surface-variant space-y-5 p-8 bg-surface-dim">
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-bold text-on-surface">PDF Reader Error</p>
          <p className="text-xs text-outline max-w-sm">{pdfjsError}</p>
        </div>
        <button
          onClick={() => window.electronAPI ? window.electronAPI.openExternal(activePdfPath) : window.open(activePdfPath)}
          className="bg-primary text-on-primary px-5 py-2.5 rounded-xl text-xs font-bold hover:opacity-90 transition-opacity shadow-md cursor-pointer"
        >
          Open in External App
        </button>
      </div>
    );
  }

  if (!pdfjsLoaded || loadingDoc) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-surface-dim space-y-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-transparent border-t-primary animate-spin" />
        </div>
        <p className="text-[10px] text-outline font-black uppercase tracking-widest animate-pulse">
          {!pdfjsLoaded ? 'Loading PDF Engine...' : 'Opening Document...'}
        </p>
      </div>
    );
  }

  // ─── MAIN RENDER ─────────────────────────────────────────────────────────
  return (
    <div className="h-full flex bg-surface-container-lowest overflow-hidden font-sans">

      {/* ─── LEFT SIDEBAR ─────────────────────────────────────────────── */}
      {isSidebarOpen && (
        <PdfSidebar
          materialId={material.id}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={handleSetSidebarOpen}
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          numPages={numPages}
          pdfDoc={pdfDoc}
          currentPage={currentPage}
          jumpToPage={jumpToPage}
          sidebarScrollRoot={sidebarScrollRoot}
          sidebarScrollContainerRef={sidebarScrollContainerRef}
          outline={outline}
          newBookmarkLabel={newBookmarkLabel}
          setNewBookmarkLabel={setNewBookmarkLabel}
          handleAddBookmark={handleAddBookmark}
          handleDeleteBookmark={handleDeleteBookmark}
          studyBookmarks={studyBookmarks}
        />
      )}

      {/* Main workspace container wrapping Reader + Blackboard */}
      <div className="flex-1 flex min-w-0 h-full">
        {/* ─── MAIN READER COLUMN ───────────────────────────────────────── */}
        <div className={`flex flex-col min-w-0 h-full bg-surface-dim transition-all ${
          isBlackboardOpen
            ? (isBlackboardFullScreen ? 'w-0 opacity-0 overflow-hidden pointer-events-none' : 'flex-[2]')
            : 'flex-1'
        }`}>

          {/* ── TOP TOOLBAR (and annotation sub-row when active) ── */}
          <PdfToolbar
            currentPage={currentPage}
            numPages={numPages}
            jumpToPage={jumpToPage}
            zoom={zoom}
            setZoom={setZoom}
            rotation={rotation}
            setRotation={setRotation}
            readingFilter={readingFilter}
            setReadingFilter={setReadingFilter}
            isDrawMode={isDrawMode}
            setIsDrawMode={setIsDrawMode}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            penColor={penColor}
            setPenColor={setPenColor}
            penWidth={penWidth}
            setPenWidth={setPenWidth}
            highlighterColor={highlighterColor}
            setHighlighterColor={setHighlighterColor}
            highlighterWidth={highlighterWidth}
            setHighlighterWidth={setHighlighterWidth}
            runAnnotationCommand={runAnnotationCommand}
            clearPageAnnotations={clearPageAnnotations}
            ingestionStatus={ingestionStatus}
            workspaceMode={getActiveWorkspaceMode()}
            onSetWorkspaceMode={handleSetWorkspaceMode}
          />

          {/* ── SCROLL READER ── */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-auto py-8 px-6 flex flex-col items-center gap-6 bg-surface-dim"
          >
            {Array.from({ length: numPages }).map((_, i) => (
              <PdfPageItem
                key={i + 1}
                pageNum={i + 1}
                pdfDoc={pdfDoc}
                zoom={zoom}
                rotation={rotation}
                isDrawMode={isDrawMode}
                activeTool={activeTool}
                penColor={penColor}
                penWidth={penWidth}
                highlighterColor={highlighterColor}
                highlighterWidth={highlighterWidth}
                materialId={material.id}
                readingFilter={readingFilter}
                drawTriggerCount={drawTriggerCount}
                annotationCommand={annotationCommand}
                onSelectionActiveChange={(active) => { isUserSelectingRef.current = active; }}
                activeSelectionPage={activeSelectionPage}
                setActiveSelectionPage={setActiveSelectionPage}
                scrollContainerEl={scrollRoot}
                highlightReloadTrigger={highlightReloadTrigger}
              />
            ))}
          </div>
        </div>

        {/* Blackboard Panel */}
        {isBlackboardOpen && (
          <div className={`flex flex-col border-l border-white/10 bg-[#1a2a1a] transition-all duration-300 ${
            isBlackboardFullScreen ? 'flex-1 min-w-0' : 'w-80 min-w-[260px] max-w-[380px] shrink-0'
          }`}>
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between shrink-0 select-none">
              <span className="text-[10px] font-black text-green-400/60 uppercase tracking-widest">Blackboard</span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setIsBlackboardFullScreen(!isBlackboardFullScreen)}
                  className="text-white/30 hover:text-white/60 text-[9px] cursor-pointer"
                  title={isBlackboardFullScreen ? "Split screen layout" : "Full screen layout"}
                >
                  {isBlackboardFullScreen ? 'Show Doc' : 'Fullscreen'}
                </button>
                <button onClick={() => blackboardRef.current?.clear()} className="text-white/30 hover:text-white/60 text-[9px] cursor-pointer">Clear</button>
                <button onClick={() => handleSetBlackboardOpen(false)} className="text-white/30 hover:text-white/60 cursor-pointer text-sm font-semibold">×</button>
              </div>
            </div>
            <BlackboardCanvas
              ref={blackboardRef}
              actions={boardActionQueue}
              onActionsConsumed={() => setBoardActionQueue([])}
              onStateChange={(state) => setProfessorSession(prev => ({ ...prev, boardStateSnapshot: state }))}
              initialState={professorSession.boardStateSnapshot}
            />
          </div>
        )}
      </div>

      {/* ─── AI ASSISTANT PANEL ───────────────────────────────────────── */}
      <AiTutorPanel
        material={material}
        currentPage={currentPage}
        numPages={numPages}
        pdfDoc={pdfDoc}
        isAiPaneOpen={isAiPaneOpen}
        setIsAiPaneOpen={handleSetAiPaneOpen}
        professorSession={professorSession}
        setProfessorSession={setProfessorSession}
        onAnnotations={setProfessorAnnotations}
        onBoardActions={enqueueBoardActions}
        jumpToPage={jumpToPage}
      />
    </div>
  );
}



// ─── PAGE RENDERER SUBCOMPONENT ──────────────────────────────────────────────
interface PdfPageItemProps {
  pageNum: number;
  pdfDoc: any;
  zoom: number;
  rotation: number;
  isDrawMode: boolean;
  activeTool: 'pen' | 'highlighter' | 'eraser';
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  materialId: string;
  readingFilter: 'default' | 'sepia' | 'dark';
  drawTriggerCount: number;
  annotationCommand: AnnotationCommand | null;
  onSelectionActiveChange?: (active: boolean) => void;
  activeSelectionPage: number | null;
  setActiveSelectionPage: (pageNum: number | null) => void;
  /** Pass down the scroll container so selection drag can auto-scroll */
  scrollContainerEl: HTMLDivElement | null;
  highlightReloadTrigger?: number;
}

function PdfPageItem({
  pageNum,
  pdfDoc,
  zoom,
  rotation,
  isDrawMode,
  activeTool,
  penColor,
  penWidth,
  highlighterColor,
  highlighterWidth,
  materialId,
  readingFilter,
  drawTriggerCount,
  annotationCommand,
  onSelectionActiveChange,
  activeSelectionPage,
  setActiveSelectionPage,
  scrollContainerEl,
  highlightReloadTrigger,
}: PdfPageItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [dimensions, setDimensions] = useState({ w: Math.round(595 * zoom), h: Math.round(842 * zoom) });
  const [hoveredAiHighlight, setHoveredAiHighlight] = useState<{ x: number; y: number } | null>(null);

  // Sync default dimensions when zoom or rotation changes to prevent layout shifts
  useEffect(() => {
    const isRotated = rotation % 180 !== 0;
    const baseW = isRotated ? 842 : 595;
    const baseH = isRotated ? 595 : 842;
    setDimensions({ w: Math.round(baseW * zoom), h: Math.round(baseH * zoom) });
  }, [zoom, rotation]);

  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !scrollContainerEl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      {
        root: scrollContainerEl,
        rootMargin: '1200px 0px 1200px 0px', // Pre-render pages within 1200px buffer
      }
    );

    observer.observe(el);
    return () => {
      observer.unobserve(el);
    };
  }, [scrollContainerEl]);

  // Strokes stored in ref for up-to-date access in event handlers
  const strokesRef = useRef<DrawingStroke[]>([]);
  const undoStackRef = useRef<DrawingStroke[][]>([]);
  const redoStackRef = useRef<DrawingStroke[][]>([]);
  const [strokeVersion, setStrokeVersion] = useState(0); // triggers redraws

  const isDrawingRef = useRef(false);
  const eraserMovedRef = useRef(false);

  // Custom Canvas Selection hook
  const processedTextItemsRef = useRef<ProcessedTextItem[]>([]);

  const {
    customSelection,
    selectionToolbar,
    highlights,
    highlightVersion,
    addTextHighlight,
    addTextMark,
    deleteHighlight,
    copySelectedText,
    handlePageMouseDown,
    handlePageDoubleClick,
  } = usePdfSelection({
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
  });

  // Flash newly added professor highlights (UX 5)
  const flashedIdsRef = useRef<Set<string>>(new Set());
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    let shouldFlash = false;
    for (const h of highlights) {
      if (h.source === 'professor' && !flashedIdsRef.current.has(h.id)) {
        flashedIdsRef.current.add(h.id);
        shouldFlash = true;
      }
    }
    if (shouldFlash) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 600);
      return () => clearTimeout(timer);
    }
  }, [highlights]);

  const handlePagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDrawMode) {
      setHoveredAiHighlight(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const normX = mouseX / rect.width;
    const normY = mouseY / rect.height;

    // Find if coordinates are inside any of the AI highlights on this page
    const hitHighlight = highlights.find((h) =>
      h.source === 'professor' &&
      h.rects.some(
        (r) => normX >= r.x && normX <= r.x + r.w && normY >= r.y && normY <= r.y + r.h
      )
    );

    if (hitHighlight) {
      const activeRect = hitHighlight.rects.find(
        (r) => normX >= r.x && normX <= r.x + r.w && normY >= r.y && normY <= r.y + r.h
      );
      if (activeRect) {
        setHoveredAiHighlight({
          x: (activeRect.x + activeRect.w) * rect.width,
          y: activeRect.y * rect.height,
        });
      } else {
        setHoveredAiHighlight({ x: mouseX, y: mouseY });
      }
    } else {
      setHoveredAiHighlight(null);
    }
  };

  const handlePagePointerLeave = () => {
    setHoveredAiHighlight(null);
  };

  // Load strokes from SQLite / localStorage
  const loadStrokes = useCallback(async () => {
    if (window.electronAPI?.professorGetAnnotations) {
      try {
        const dbAnnotations = await window.electronAPI.professorGetAnnotations(materialId, pageNum);
        const strokeAnn = dbAnnotations.find((a: any) => a.type === 'stroke');
        if (strokeAnn && strokeAnn.stroke_data) {
          try {
            strokesRef.current = JSON.parse(strokeAnn.stroke_data);
          } catch {
            strokesRef.current = [];
          }
          // Clean up localStorage keys on successful DB load
          const raw = localStorage.getItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`);
          if (raw) {
            localStorage.removeItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`);
            console.log(`[V3 Cleanup] Cleaned up localStorage strokes for page ${pageNum}`);
          }
        } else {
          // Migration check
          const raw = localStorage.getItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              strokesRef.current = parsed;
              // Migrate to SQLite
              await window.electronAPI.professorSaveAnnotation({
                annotation_id: `strokes-${materialId}-${pageNum}`,
                material_id: materialId,
                page: pageNum,
                type: 'stroke',
                color: 'orange',
                stroke_data: raw,
                source: 'user',
                created_at: Date.now(),
              });
              console.log(`[V3 Migration] Migrating strokes for page ${pageNum} to SQLite`);
              localStorage.removeItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`);
            } catch {
              strokesRef.current = [];
            }
          } else {
            strokesRef.current = [];
          }
        }
      } catch (err) {
        console.error('[loadStrokes] Failed loading strokes from DB:', err);
        // fallback
        const raw = localStorage.getItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`);
        if (raw) {
          try { strokesRef.current = JSON.parse(raw); } catch { strokesRef.current = []; }
        } else {
          strokesRef.current = [];
        }
      }
    } else {
      const raw = localStorage.getItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`);
      if (raw) {
        try { strokesRef.current = JSON.parse(raw); }
        catch { strokesRef.current = []; }
      } else {
        strokesRef.current = [];
      }
    }
    setStrokeVersion(v => v + 1);
  }, [materialId, pageNum]);

  useEffect(() => { loadStrokes(); }, [loadStrokes, drawTriggerCount]);

  const persistStrokes = () => {
    const serialized = JSON.stringify(strokesRef.current);
    if (window.electronAPI?.professorSaveAnnotation) {
      window.electronAPI.professorSaveAnnotation({
        annotation_id: `strokes-${materialId}-${pageNum}`,
        material_id: materialId,
        page: pageNum,
        type: 'stroke',
        color: 'orange',
        stroke_data: serialized,
        source: 'user',
        created_at: Date.now(),
      });
    } else {
      localStorage.setItem(`corvovault-pdf-strokes-${materialId}-${pageNum}`, serialized);
    }
  };

  const cloneStrokes = (strokes: DrawingStroke[]) =>
    strokes.map(stroke => ({
      ...stroke,
      points: stroke.points.map(point => ({ ...point })),
    }));

  const pushUndoSnapshot = () => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), cloneStrokes(strokesRef.current)];
    redoStackRef.current = [];
  };

  const replaceStrokes = (next: DrawingStroke[], persist = true) => {
    strokesRef.current = cloneStrokes(next);
    setStrokeVersion(v => v + 1);
    if (persist) persistStrokes();
  };

  useEffect(() => {
    if (!annotationCommand || annotationCommand.pageNum !== pageNum) return;

    if (annotationCommand.type === 'undo') {
      const previous = undoStackRef.current.pop();
      if (!previous) return;
      redoStackRef.current = [...redoStackRef.current, cloneStrokes(strokesRef.current)];
      replaceStrokes(previous);
      return;
    }

    if (annotationCommand.type === 'redo') {
      const next = redoStackRef.current.pop();
      if (!next) return;
      undoStackRef.current = [...undoStackRef.current, cloneStrokes(strokesRef.current)];
      replaceStrokes(next);
      return;
    }

    if (annotationCommand.type === 'clear') {
      if (strokesRef.current.length === 0) return;
      pushUndoSnapshot();
      replaceStrokes([]);
    }
  }, [annotationCommand, pageNum]);

  // ── Synchronise both canvases to identical pixel dimensions ──────────
  // Called after PDF render completes to ensure the draw overlay is exactly
  // the same size as the PDF canvas — eliminates edge / gap artifacts.
  const syncDrawCanvas = useCallback((cssW: number, cssH: number) => {
    const canvases = [drawCanvasRef.current, highlightCanvasRef.current].filter(Boolean) as HTMLCanvasElement[];
    const dpr = window.devicePixelRatio || 1;
    const backingW = Math.round(cssW * dpr);
    const backingH = Math.round(cssH * dpr);
    canvases.forEach(canvas => {
      if (canvas.width !== backingW || canvas.height !== backingH) {
        canvas.width = backingW;
        canvas.height = backingH;
      }
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    });
  }, []);

  // Render PDF page
  useEffect(() => {
    if (!pdfDoc || !isIntersecting) return;

    let active = true;

    const render = async () => {
      setLoading(true);
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (!active) return;

        renderTaskRef.current?.cancel();

        const canvas = pdfCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        // Compute the viewport at device-pixel resolution for crisp rendering.
        const viewport = page.getViewport({ scale: zoom * dpr, rotation });

        // CSS-pixel dimensions (what the user sees)
        const cssW = Math.round(viewport.width / dpr);
        const cssH = Math.round(viewport.height / dpr);

        // Set backing store to exact viewport pixels
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        setDimensions({ w: cssW, h: cssH });

        // Pre-size the draw overlay BEFORE the PDF finishes painting so there
        // is never a frame where an unsized overlay canvas creates artefacts.
        syncDrawCanvas(cssW, cssH);

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (active) {
          const textLayer = textLayerRef.current;
          if (textLayer) {
            textLayer.innerHTML = '';
            textLayer.style.width = `${cssW}px`;
            textLayer.style.height = `${cssH}px`;

            const pdfjsLib = (window as any).pdfjsLib;
            const textContent = await page.getTextContent();
            const textViewport = page.getViewport({ scale: zoom, rotation });
            await renderSelectableTextLayer(pdfjsLib, textLayer, textContent, textViewport, processedTextItemsRef);
          }

          setLoading(false);
          // Ensure the draw canvas is still in sync (in case a resize
          // happened between pre-sizing and render completion).
          syncDrawCanvas(cssW, cssH);
          setStrokeVersion(v => v + 1); // trigger stroke redraw
        }
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException' && active) setLoading(false);
      }
    };

    render();
    return () => {
      active = false;
      renderTaskRef.current?.cancel();
    };
  }, [pdfDoc, pageNum, zoom, rotation, syncDrawCanvas, isIntersecting]);

  // Helper to draw premium, rounded highlight rectangles on canvas
  const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  };

  useEffect(() => {
    if (loading || !isIntersecting) return;
    const canvas = highlightCanvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    const cssW = parseFloat(canvas.style.width) || (canvas.width / dpr);
    const cssH = parseFloat(canvas.style.height) || (canvas.height / dpr);
    ctx.scale(dpr, dpr);
    ctx.globalCompositeOperation = 'multiply';

    highlights.forEach(mark => {
      const type = mark.type || 'highlight';
      let rects = mark.rects;
      if ((!rects || rects.length === 0) && processedTextItemsRef.current?.length > 0) {
        const computed = findRectsForTextCV(mark.text, processedTextItemsRef.current, cssW, cssH);
        rects = computed.map(r => ({
          x: r.x / cssW,
          y: r.y / cssH,
          w: r.w / cssW,
          h: r.h / cssH
        }));
        mark.rects = rects; // Cache it in-place
      }

      (rects || []).forEach(rect => {
        const x = rect.x * cssW;
        const y = rect.y * cssH;
        const w = rect.w * cssW;
        const h = rect.h * cssH;

        if (type === 'underline') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = mark.color;
          ctx.lineWidth = Math.max(2, h * 0.12);
          ctx.lineCap = 'round';
          const lineY = y + h * 0.88;
          ctx.beginPath();
          ctx.moveTo(x, lineY);
          ctx.lineTo(x + w, lineY);
          ctx.stroke();
          ctx.globalCompositeOperation = 'multiply';
          return;
        }

        if (type === 'strike') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = mark.color;
          ctx.lineWidth = Math.max(2, h * 0.11);
          ctx.lineCap = 'round';
          const lineY = y + h * 0.52;
          ctx.beginPath();
          ctx.moveTo(x, lineY);
          ctx.lineTo(x + w, lineY);
          ctx.stroke();
          ctx.globalCompositeOperation = 'multiply';
          return;
        }

        // Map common color names/hex codes to beautiful translucent highlight colors
        let drawColor = mark.color || 'orange';
        if (type === 'highlight') {
          const lowerColor = drawColor.toLowerCase().trim();
          if (lowerColor === 'orange') {
            drawColor = 'rgba(249, 115, 22, 0.45)'; // Beautiful modern orange
          } else if (lowerColor === 'yellow' || lowerColor === '#fbbf24' || lowerColor === '#ffeb3b') {
            drawColor = 'rgba(253, 224, 71, 0.55)'; // Beautiful modern yellow
          } else if (lowerColor === 'green' || lowerColor === '#4caf50' || lowerColor === '#22c55e') {
            drawColor = 'rgba(34, 197, 94, 0.45)'; // Beautiful modern green
          } else if (lowerColor === 'blue' || lowerColor === '#2196f3' || lowerColor === '#3b82f6') {
            drawColor = 'rgba(59, 130, 246, 0.45)'; // Beautiful modern blue
          } else if (lowerColor === 'red' || lowerColor === '#f44336' || lowerColor === '#ef4444') {
            drawColor = 'rgba(239, 68, 68, 0.45)'; // Beautiful modern red
          } else if (lowerColor === 'pink' || lowerColor === '#e91e63' || lowerColor === '#ec4899') {
            drawColor = 'rgba(236, 72, 153, 0.45)'; // Beautiful modern pink
          } else if (lowerColor === 'purple' || lowerColor === '#9c27b0' || lowerColor === '#a855f7') {
            drawColor = 'rgba(168, 85, 247, 0.45)'; // Beautiful modern purple
          } else {
            // Apply global alpha fallback if the color has no alpha
            const hasAlpha = /rgba|hsla/i.test(drawColor) || (drawColor.startsWith('#') && drawColor.length > 7);
            ctx.globalAlpha = hasAlpha ? 1.0 : 0.45;
          }
        }
        ctx.fillStyle = drawColor;
        drawRoundedRect(ctx, x, y, w, h, 4);
        ctx.globalAlpha = 1.0; // Reset alpha
      });
    });

    // Draw actively-dragged custom text selection with premium rounded rendering
    if (customSelection) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.35)'; // Modern selection blue
      const rects = getCustomSelectionRects(customSelection, processedTextItemsRef.current, dimensions.w, dimensions.h);
      rects.forEach(rect => {
        drawRoundedRect(ctx, rect.x * cssW, rect.y * cssH, rect.w * cssW, rect.h * cssH, 4);
      });
    }

    ctx.globalCompositeOperation = 'source-over';
  }, [highlightVersion, loading, customSelection, dimensions, highlights]);

  // Redraw strokes overlay
  useEffect(() => {
    if (loading || !isIntersecting) return;
    const dc = drawCanvasRef.current;
    if (!dc || dc.width === 0 || dc.height === 0) return;
    const ctx = dc.getContext('2d');
    if (!ctx) return;

    // Reset transform then clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dc.width, dc.height);

    // No strokes → nothing to draw
    if (strokesRef.current.length === 0) return;

    // Scale to DPR so stroke coordinates (stored in 0..1 normalised space)
    // map to CSS-layout pixels, then the DPR backing handles crispness.
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    // CSS-pixel size of the canvas (matches the PDF page exactly)
    const cssW = parseFloat(dc.style.width) || (dc.width / dpr);
    const cssH = parseFloat(dc.style.height) || (dc.height / dpr);

    strokesRef.current.forEach(stroke => {
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.globalCompositeOperation = stroke.type === 'highlighter' ? 'multiply' : 'source-over';

      if (stroke.points.length === 1) {
        ctx.fillStyle = stroke.color;
        const point = stroke.points[0];
        ctx.arc(point.x * cssW, point.y * cssH, Math.max(1, stroke.width / 2), 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      ctx.moveTo(stroke.points[0].x * cssW, stroke.points[0].y * cssH);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const current = stroke.points[i];
        const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(
          current.x * cssW,
          current.y * cssH,
          ((current.x + next.x) / 2) * cssW,
          ((current.y + next.y) / 2) * cssH
        );
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x * cssW, last.y * cssH);
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }, [strokeVersion, loading]);

  // ── Canvas pointer coords (Pointer events for touch/pen support) ──────
  const getCoords = (e: React.PointerEvent<HTMLCanvasElement> | { clientX: number; clientY: number }) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'clientX' in e ? (e as any).clientX : 0;
    const clientY = 'clientY' in e ? (e as any).clientY : 0;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !isDrawMode) return;
    e.preventDefault();

    const coords = getCoords(e);

    if (activeTool === 'eraser') {
      eraserMovedRef.current = true;
      eraseAt(coords);
      return;
    }

    const strokes = strokesRef.current;
    if (strokes.length === 0) return;
    const last = { ...strokes[strokes.length - 1] };
    if (e.shiftKey && last.points.length > 0) {
      last.points = [last.points[0], coords];
      strokesRef.current = [...strokes.slice(0, -1), last];
      setStrokeVersion(v => v + 1);
      return;
    }

    const previousPoint = last.points[last.points.length - 1];
    if (previousPoint) {
      const dx = previousPoint.x - coords.x;
      const dy = previousPoint.y - coords.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.0015) return;
    }
    last.points = [...last.points, coords];
    strokesRef.current = [...strokes.slice(0, -1), last];
    setStrokeVersion(v => v + 1);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      const target = e.currentTarget as Element;
      try { target.releasePointerCapture?.(e.pointerId); } catch {}
      persistStrokes();
      eraserMovedRef.current = false;
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      const target = e.currentTarget as Element;
      try { target.releasePointerCapture?.(e.pointerId); } catch {}
      persistStrokes();
      eraserMovedRef.current = false;
    }
  };

  const eraseAt = (coords: { x: number; y: number }) => {
    const threshold = 0.018;
    
    // Erase strokes
    const beforeStrokes = strokesRef.current.length;
    strokesRef.current = strokesRef.current.filter(s =>
      !strokeHitsPoint(s, coords, threshold)
    );
    if (strokesRef.current.length !== beforeStrokes) {
      setStrokeVersion(v => v + 1);
      if (!eraserMovedRef.current) persistStrokes();
    }

    // Erase text highlights
    const hitHighlights = highlights.filter(h =>
      h.rects.some(rect =>
        coords.x >= rect.x && coords.x <= rect.x + rect.w &&
        coords.y >= rect.y && coords.y <= rect.y + rect.h
      )
    );
    hitHighlights.forEach(h => deleteHighlight(h.id));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawMode) return;
    e.preventDefault();
    const target = e.currentTarget as Element;
    try { target.setPointerCapture?.(e.pointerId); } catch {}
    isDrawingRef.current = true;

    const coords = getCoords(e);
    pushUndoSnapshot();

    if (activeTool === 'eraser') {
      eraserMovedRef.current = false;
      eraseAt(coords);
      return;
    }

    const stroke: DrawingStroke = {
      id: Math.random().toString(36).slice(2, 9),
      type: activeTool,
      color: activeTool === 'highlighter' ? highlighterColor : penColor,
      width: activeTool === 'highlighter' ? highlighterWidth : penWidth,
      points: [coords],
    };
    strokesRef.current = [...strokesRef.current, stroke];
    setStrokeVersion(v => v + 1);
  };



  const filterStyle = (() => {
    if (readingFilter === 'sepia') return { filter: 'sepia(0.6) contrast(1.05) brightness(0.97)' };
    if (readingFilter === 'dark') return { filter: 'invert(0.92) hue-rotate(180deg) contrast(1.1)' };
    return {};
  })();

  return (
    <div
      ref={containerRef}
      id={`pdf-page-wrapper-${materialId}-${pageNum}`}
      className={`pdf-selectable-page rounded-lg overflow-hidden relative bg-white scroll-mt-4 shrink-0`}
      onMouseDown={(e) => handlePageMouseDown(e, containerRef.current)}
      onDoubleClick={(e) => handlePageDoubleClick(e, containerRef.current)}
      onPointerMove={handlePagePointerMove}
      onPointerLeave={handlePagePointerLeave}
      style={{
        width: `${dimensions.w}px`,
        height: `${dimensions.h}px`,
        ...filterStyle,
        // Show text cursor on page when in select mode so users know it's selectable
        cursor: isDrawMode ? 'default' : 'text',
        boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {isIntersecting ? (
        <>
          <canvas
            ref={pdfCanvasRef}
            className="absolute top-0 left-0 block"
            style={{ width: `${dimensions.w}px`, height: `${dimensions.h}px` }}
          />

          <canvas
            ref={highlightCanvasRef}
            className={`absolute top-0 left-0 pointer-events-none z-10 ${isFlashing ? 'highlight-flash' : ''}`}
            style={{ width: `${dimensions.w}px`, height: `${dimensions.h}px` }}
          />

          {/* Text layer is always pointer-events-none — all mouse events are handled
              by the container div so there's no ghost drag / event-stealing from spans */}
          <div
            ref={textLayerRef}
            className="pdf-text-layer absolute top-0 left-0 z-20 pointer-events-none"
            style={{ width: `${dimensions.w}px`, height: `${dimensions.h}px` }}
          />

          <canvas
            ref={drawCanvasRef}
            className={`absolute top-0 left-0 ${
              isDrawMode
                ? activeTool === 'highlighter'
                  ? 'cursor-cell pointer-events-auto z-30'
                  : 'cursor-crosshair pointer-events-auto z-30'
                : 'pointer-events-none z-10'
            }`}
            style={{ width: `${dimensions.w}px`, height: `${dimensions.h}px` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-30">
              <div className="w-8 h-8 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            </div>
          )}

          {selectionToolbar && !isDrawMode && (
            <SelectionToolbar
              materialId={materialId}
              pageNum={pageNum}
              selectionToolbar={selectionToolbar}
              deleteHighlight={deleteHighlight}
              addTextHighlight={addTextHighlight}
              addTextMark={addTextMark}
              copySelectedText={copySelectedText}
            />
          )}
        </>
      ) : null}

      {hoveredAiHighlight && (
        <div
          className="absolute z-[35] pointer-events-none select-none px-1.5 py-0.5 rounded bg-neutral-950/85 text-[8px] font-black uppercase tracking-widest text-neutral-100 border border-white/10 shadow-sm flex items-center gap-1 animate-in fade-in duration-100"
          style={{
            left: `${hoveredAiHighlight.x}px`,
            top: `${hoveredAiHighlight.y - 16}px`,
            transform: 'translateX(-100%)',
          }}
        >
          ✦ by AI
        </div>
      )}
    </div>
  );
}

function strokeHitsPoint(
  stroke: DrawingStroke,
  point: { x: number; y: number },
  threshold: number
) {
  if (stroke.points.length === 0) return false;
  const strokeRadius = Math.max(threshold, (stroke.width / 1000) * 1.4);

  if (stroke.points.length === 1) {
    return distance(stroke.points[0], point) <= strokeRadius;
  }

  for (let i = 1; i < stroke.points.length; i++) {
    if (distanceToSegment(point, stroke.points[i - 1], stroke.points[i]) <= strokeRadius) {
      return true;
    }
  }

  return false;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = point.x - start.x;
  const wy = point.y - start.y;
  const lengthSquared = vx * vx + vy * vy;

  if (lengthSquared === 0) return distance(point, start);

  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return distance(point, {
    x: start.x + t * vx,
    y: start.y + t * vy,
  });
}

async function renderSelectableTextLayer(
  pdfjsLib: any,
  container: HTMLDivElement,
  textContent: any,
  viewport: any,
  processedTextItemsRef: React.MutableRefObject<ProcessedTextItem[]>
) {
  container.innerHTML = '';
  renderManualSelectableTextLayer(pdfjsLib, container, textContent, viewport, processedTextItemsRef);
}

function renderManualSelectableTextLayer(
  pdfjsLib: any,
  container: HTMLDivElement,
  textContent: any,
  viewport: any,
  processedTextItemsRef: React.MutableRefObject<ProcessedTextItem[]>
) {
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  const util = pdfjsLib?.Util;

  // Use a canvas context to measure natural text width for perfect scaleX calculation
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  // 1. Process items to compute coordinates and visual baseline positions
  const processedItems = items
    .map(item => {
      if (!item?.str) return null;

      const transform = util?.transform
        ? util.transform(viewport.transform, item.transform)
        : multiplyTransforms(viewport.transform, item.transform);

      const fontHeight = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || 10;
      const angle = Math.atan2(transform[1], transform[0]);
      const left = transform[4];

      // Selection rects use the full glyph box: from ascender top to descender bottom.
      // transform[5] is the baseline in screen-Y-down coordinates.
      // The visual top of the glyph (ascender line) is approximately baseline - fontHeight.
      // Using the full fontHeight gives a rect that tightly encloses the glyph,
      // matching Chrome and Adobe's highlight behaviour.
      const top = transform[5] - fontHeight;

      // For span CSS positioning we use a slightly tighter offset so the visible
      // (transparent) span aligns with the rendered glyph for cursor / hit purposes.
      // 0.82 is the standard PDF ascender ratio; adjust if a PDF uses unusual fonts.
      const visualTop = transform[5] - fontHeight * 0.82;

      const width = Math.max(8, (item.width || item.str.length * fontHeight * 0.55) * viewport.scale);

      // Extract precise fontFamily from PDF styles metadata mapping
      const fontName = item.fontName;
      const style = textContent.styles?.[fontName];
      const fontFamily = style?.fontFamily || 'sans-serif';

      return {
        item,
        transform,
        fontHeight,
        angle,
        left,
        top,
        visualTop,
        width,
        fontFamily,
      };
    })
    .filter(Boolean) as any[];

  // ── PHASE 1: Compute row buckets ────────────────────────────────────────────
  // Determine median font height so we can bucket items into visual rows.
  // Items whose `top` values differ by less than (0.65 × medFH) are considered
  // to be on the SAME visual line, regardless of sub-pixel baseline differences.
  const sortedFH = processedItems.map((i: any) => i.fontHeight).sort((a: number, b: number) => a - b);
  const medFH: number = sortedFH.length > 0 ? sortedFH[Math.floor(sortedFH.length / 2)] : 12;
  const rowBucket: number = Math.max(4, medFH * 0.65);

  // Attach a `rowKey` to every item so the sort comparator is stable and O(n log n)
  processedItems.forEach((item: any) => {
    item._rowKey = Math.round(item.top / rowBucket);
  });

  // ── PHASE 2: Stable visual row-major sort ───────────────────────────────────
  // Rule: same row bucket → sort left-to-right.
  //       different rows  → sort top-to-bottom.
  //
  // This is the ONLY sort needed. It is deterministic, column-detection-agnostic,
  // and produces perfect visual reading order for every PDF layout:
  //   • Single-column paragraphs ✓
  //   • Numbered / bulleted lists ✓
  //   • Tables ✓
  //   • Mixed-layout pages ✓
  //   • True academic double-columns ✓ (left→right within each row, which is correct
  //     for same-row items; column-first reading order is handled at copy time only)
  processedItems.sort((a: any, b: any) => {
    if (a._rowKey !== b._rowKey) return a._rowKey - b._rowKey;
    return a.left - b.left;
  });

  // Clean up the temporary row key (not needed after sort)
  processedItems.forEach((item: any) => { delete item._rowKey; });

  // ── PHASE 3: Post-sort column & profile rebuild ──────────────────────────────
  // Re-detect columns on the now-correctly-sorted array. This result is used by
  // getCustomSelectionText (copy) and triple-click line selection — NOT by the
  // sort or selection highlight (which only cares about array index order).
  detectAndAssignColumns(processedItems, viewport.width, viewport.height);

  profileCache.delete(processedItems);
  const finalProfile = ensureProfile(processedItems, viewport.width, viewport.height);

  // Attach lineGroupId from the correctly-ordered profile for triple-click and copy-text use.
  processedItems.forEach((item: any, idx: number) => {
    item.lineGroupId = finalProfile.lineGroups.get(idx) ?? 0;
  });

  // Assign to the ref so the custom canvas selection engine can query text geometrically
  processedTextItemsRef.current = processedItems;

  // 3. Render and append spans in sorted visual reading order (accessibility/DOM order)
  for (const p of processedItems) {
    const span = document.createElement('span');
    span.textContent = p.item.str;
    span.dir = p.item.dir || 'ltr';
    span.dataset.pdfText = 'true';
    // DOM-Guard: Prevent browser from ever initiating a drag-and-drop state on text layer spans
    span.setAttribute('draggable', 'false');

    let scaleX = 1;
    if (measureCtx) {
      measureCtx.font = `${p.fontHeight}px ${p.fontFamily || 'sans-serif'}`;
      const naturalWidth = measureCtx.measureText(p.item.str).width;
      if (naturalWidth > 0) {
        scaleX = p.width / naturalWidth;
      }
    }

    span.style.left = `${p.left}px`;
    span.style.top = `${p.visualTop ?? p.top}px`;
    span.style.fontSize = `${p.fontHeight}px`;
    span.style.fontFamily = p.fontFamily || 'sans-serif';
    span.style.boxSizing = 'border-box';
    span.style.width = `${p.width}px`;
    span.style.height = `${p.fontHeight}px`;
    span.style.padding = '0';
    span.style.margin = '0';
    // Use left-center transform origin so scaleX compresses text from the left edge
    // (matches PDF glyph origin) rather than from the span center.
    span.style.transformOrigin = '0% 50%';
    span.style.transform = `rotate(${p.angle}rad) scaleX(${scaleX})`;

    container.appendChild(span);
  }
}

function multiplyTransforms(a: number[], b: number[]) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
