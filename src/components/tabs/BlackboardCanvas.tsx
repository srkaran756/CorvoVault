import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { BoardAction } from '../../types';

interface BlackboardCanvasProps {
  actions: BoardAction[];
  onActionsConsumed: () => void;
  onStateChange: (state: any) => void;
  initialState?: any;
}

export interface BlackboardCanvasHandle {
  clear: () => void;
}

const BlackboardCanvas = forwardRef<BlackboardCanvasHandle, BlackboardCanvasProps>(
  ({ actions, onActionsConsumed, onStateChange, initialState }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const itemsRef = useRef<BoardAction[]>([]);

    // Restore initial board state on mount
    useEffect(() => {
      if (!initialState?.actions || !canvasRef.current) return;
      itemsRef.current = initialState.actions;
      redrawAll();
    }, []);

    // Execute queued actions with timing
    useEffect(() => {
      if (!actions.length) return;
      const timers: ReturnType<typeof setTimeout>[] = [];

      for (const action of actions) {
        timers.push(setTimeout(() => executeAction(action), action.timing));
      }

      const maxTiming = Math.max(...actions.map(a => a.timing)) + 300;
      timers.push(setTimeout(() => {
        onActionsConsumed();
        onStateChange({ actions: itemsRef.current });
      }, maxTiming));

      return () => timers.forEach(clearTimeout);
    }, [actions]);

    const getCtx = () => canvasRef.current?.getContext('2d') ?? null;

    const executeAction = useCallback((action: BoardAction) => {
      const canvas = canvasRef.current;
      const ctx = getCtx();
      if (!canvas || !ctx) return;

      const x = action.position.x * canvas.width;
      const y = action.position.y * canvas.height;

      const colorMap: Record<string, string> = {
        white: '#f0f0e8', yellow: '#fbbf24', red: '#ef4444',
        green: '#4ade80', blue: '#60a5fa'
      };
      const color = colorMap[action.style.color] || '#f0f0e8';

      if (action.tool === 'erase') {
        ctx.clearRect(x - 20, y - 20, 40, 40);
        return;
      }

      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.globalAlpha = action.tool === 'chalk' ? 0.85 : 1.0;
      ctx.font = `${action.tool === 'marker' ? 'bold' : 'normal'} ${action.style.size}px 'Segoe UI', sans-serif`;

      // Chalk texture: draw twice with slight offset
      if (action.tool === 'chalk') {
        ctx.globalAlpha = 0.3;
        ctx.fillText(action.content, x + 0.5, y + 0.5);
        ctx.globalAlpha = 0.85;
      }

      ctx.fillText(action.content, x, y);

      // Emphasis decorations
      if (action.style.emphasis) {
        const w = ctx.measureText(action.content).width;
        ctx.lineWidth = 1.5;
        if (action.style.emphasis === 'underline') {
          ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x + w, y + 4); ctx.stroke();
        } else if (action.style.emphasis === 'box') {
          ctx.strokeRect(x - 6, y - action.style.size - 4, w + 12, action.style.size + 10);
        } else if (action.style.emphasis === 'circle') {
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y - action.style.size / 2, w / 2 + 14, action.style.size / 2 + 10, 0, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }

      ctx.restore();
      itemsRef.current = [...itemsRef.current, action];
    }, []);

    const redrawAll = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = getCtx();
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const action of itemsRef.current) executeAction(action);
    }, [executeAction]);

    // ResizeObserver: keep canvas pixel size = display size × devicePixelRatio
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas?.parentElement) return;
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.scale(dpr, dpr); redrawAll(); }
      });
      ro.observe(canvas.parentElement);
      return () => ro.disconnect();
    }, []);

    useImperativeHandle(ref, () => ({
      clear: () => {
        const ctx = getCtx();
        const canvas = canvasRef.current;
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        itemsRef.current = [];
        onStateChange({ actions: [] });
      }
    }));

    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ background: 'transparent' }}
      />
    );
  }
);

BlackboardCanvas.displayName = 'BlackboardCanvas';
export default BlackboardCanvas;
