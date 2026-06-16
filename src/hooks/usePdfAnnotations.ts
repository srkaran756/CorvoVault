import { useState, useEffect } from 'react';

export type AnnotationCommand = {
  id: number;
  pageNum: number;
  type: 'undo' | 'redo' | 'clear';
};

export function usePdfAnnotations(materialId: string, currentPage: number) {
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [activeTool, setActiveTool] = useState<'pen' | 'highlighter' | 'eraser'>('highlighter');
  const [penColor, setPenColor] = useState('#ef4444');
  const [penWidth, setPenWidth] = useState(2);
  const [highlighterColor, setHighlighterColor] = useState('rgba(253,224,71,0.5)');
  const [highlighterWidth, setHighlighterWidth] = useState(8);
  const [drawTriggerCount, setDrawTriggerCount] = useState(0);
  const [annotationCommand, setAnnotationCommand] = useState<AnnotationCommand | null>(null);

  const runAnnotationCommand = (type: AnnotationCommand['type']) => {
    setAnnotationCommand({ id: Date.now(), pageNum: currentPage, type });
  };

  const clearPageAnnotations = () => {
    if (window.confirm(`Clear all annotations on Page ${currentPage}?`)) {
      setAnnotationCommand({ id: Date.now(), pageNum: currentPage, type: 'clear' });
    }
  };

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
  };
}
