import { useState, useEffect, useCallback } from 'react';
import { ipcService } from '../services/ipcService';

export type AnnotationCommand = {
  id: number;
  pageNum: number;
  type: 'undo' | 'redo' | 'clear';
};

export interface PdfAnnotationRecord {
  annotation_id?: string;
  id?: string;
  material_id?: string;
  page: number;
  type?: string;
  target_text?: string;
  color?: string;
  callout?: string;
  created_at?: number;
}

export function getColorLabel(color?: string): string {
  if (!color) return 'Highlight';
  const c = color.toLowerCase();
  if (c.includes('253,224,71') || c.includes('fde047') || c.includes('yellow')) return 'Yellow';
  if (c.includes('34,197,94') || c.includes('22c55e') || c.includes('green')) return 'Green';
  if (c.includes('59,130,246') || c.includes('3b82f6') || c.includes('blue')) return 'Blue';
  if (c.includes('236,72,153') || c.includes('ec4899') || c.includes('pink')) return 'Pink';
  if (c.includes('239,68,68') || c.includes('ef4444') || c.includes('red')) return 'Red';
  return 'Highlight';
}

export function formatAnnotationsToMarkdown(
  annotations: PdfAnnotationRecord[],
  documentTitle: string = 'Document'
): string {
  const cleanTitle = documentTitle.replace(/_/g, ' ').trim();
  if (!annotations || annotations.length === 0) {
    return `# Highlights & Annotations: ${cleanTitle}\n\n*No annotations or highlights found in this document.*`;
  }

  // Sort annotations by page ascending, then by created_at ascending
  const sorted = [...annotations].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return (a.created_at || 0) - (b.created_at || 0);
  });

  // Group by page number
  const pageMap = new Map<number, PdfAnnotationRecord[]>();
  for (const ann of sorted) {
    const list = pageMap.get(ann.page) || [];
    list.push(ann);
    pageMap.set(ann.page, list);
  }

  const lines: string[] = [];
  lines.push(`# Highlights & Annotations: ${cleanTitle}\n`);

  for (const [pageNum, pageAnns] of pageMap.entries()) {
    lines.push(`## Page ${pageNum} • [Jump to Page ${pageNum}](corvovault-pdf-page://${pageNum})\n`);

    for (const ann of pageAnns) {
      const colorLabel = getColorLabel(ann.color);
      if (ann.target_text && ann.target_text.trim()) {
        lines.push(`> "${ann.target_text.trim()}" (*${colorLabel}*)`);
      } else if (ann.type === 'pen' || ann.type === 'drawing') {
        lines.push(`- Drawing annotation on Page ${pageNum}`);
      } else if (ann.callout && ann.callout.trim()) {
        lines.push(`- Note on Page ${pageNum}`);
      }

      if (ann.callout && ann.callout.trim()) {
        lines.push(`*Note:* ${ann.callout.trim()}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export async function exportAnnotationsToNote(
  materialId: string,
  documentTitle: string = 'Document'
): Promise<{ success: boolean; note?: any; message?: string }> {
  if (!window.electronAPI) {
    return { success: false, message: 'Electron API is not available in browser mode.' };
  }

  try {
    const rawAnns = await window.electronAPI.professorGetAnnotations(materialId);
    if (!rawAnns || rawAnns.length === 0) {
      return { success: false, message: 'No annotations found in this PDF document.' };
    }

    const markdown = formatAnnotationsToMarkdown(rawAnns, documentTitle);
    const createdNote = await ipcService.notes.add(materialId, markdown);
    return { success: true, note: createdNote };
  } catch (err: any) {
    console.error('Failed to export PDF annotations:', err);
    return { success: false, message: err?.message || 'Error exporting annotations' };
  }
}

export function usePdfAnnotations(materialId: string, currentPage: number) {
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [activeTool, setActiveTool] = useState<'pen' | 'highlighter' | 'eraser'>('highlighter');
  const [penColor, setPenColor] = useState('#ef4444');
  const [penWidth, setPenWidth] = useState(2);
  const [highlighterColor, setHighlighterColor] = useState('rgba(253,224,71,0.5)');
  const [highlighterWidth, setHighlighterWidth] = useState(8);
  const [drawTriggerCount, setDrawTriggerCount] = useState(0);
  const [annotationCommand, setAnnotationCommand] = useState<AnnotationCommand | null>(null);
  const [isExportingNotes, setIsExportingNotes] = useState(false);

  const runAnnotationCommand = (type: AnnotationCommand['type']) => {
    setAnnotationCommand({ id: Date.now(), pageNum: currentPage, type });
  };

  const clearPageAnnotations = () => {
    if (window.confirm(`Clear all annotations on Page ${currentPage}?`)) {
      setAnnotationCommand({ id: Date.now(), pageNum: currentPage, type: 'clear' });
    }
  };

  const handleExportAnnotations = useCallback(async (documentTitle?: string) => {
    setIsExportingNotes(true);
    try {
      const res = await exportAnnotationsToNote(materialId, documentTitle);
      return res;
    } finally {
      setIsExportingNotes(false);
    }
  }, [materialId]);

  // Keyboard shortcut listener for Undo/Redo drawing commands
  useEffect(() => {
    if (!isDrawMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key !== 'z' && key !== 'y') return;

      event.preventDefault();
      const type = key === 'y' || event.shiftKey ? 'redo' : 'undo';
      runAnnotationCommand(type);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawMode, currentPage]);

  return {
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
    runAnnotationCommand,
    isExportingNotes,
    handleExportAnnotations,
  };
}

