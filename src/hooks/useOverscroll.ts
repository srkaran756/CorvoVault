import { useCallback, useRef } from 'react';

interface OverscrollOptions {
  resistance?: number;    // Damping resistance coefficient (default 0.28)
  maxOverscroll?: number; // Max stretch in pixels (default 50)
  tension?: number;       // Spring-back duration in ms (default 480)
}

export function useOverscroll<T extends HTMLElement = HTMLDivElement>(options: OverscrollOptions = {}) {
  const {
    resistance = 0.28,
    maxOverscroll = 50,
    tension = 480,
  } = options;

  const cleanupRef = useRef<(() => void) | null>(null);

  const refCallback = useCallback((el: T | null) => {
    // Cleanup previous listeners if any
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (!el) return;

    let overscroll = 0;
    let wheelTimeoutId: number | null = null;
    let isTouchActive = false;
    let lastTouchY = 0;

    const getChildren = (): HTMLElement[] => {
      return Array.from(el.children) as HTMLElement[];
    };

    // Elastic snap-back with overshoot wobble (spring physics simulation)
    const resetOverscroll = () => {
      overscroll = 0;
      const children = getChildren();
      
      children.forEach(child => {
        // cubic-bezier(0.175, 0.885, 0.32, 1.275) is the classic elastic bounce-back with subtle wobble
        child.style.transition = `transform ${tension}ms cubic-bezier(0.175, 0.885, 0.32, 1.275)`;
        child.style.transform = 'translateY(0px) scaleY(1)';
      });

      // Clear styles after transition completes to keep DOM clean
      const timeoutId = window.setTimeout(() => {
        if (overscroll === 0) {
          children.forEach(child => {
            child.style.transform = '';
            child.style.transition = '';
            child.style.transformOrigin = '';
          });
        }
      }, tension);

      return () => window.clearTimeout(timeoutId);
    };

    const handleWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      
      // Boundary conditions
      const isAtTop = scrollTop <= 0;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;
      
      const isScrollingUp = e.deltaY < 0;
      const isScrollingDown = e.deltaY > 0;

      if ((isAtTop && isScrollingUp) || (isAtBottom && isScrollingDown)) {
        // Prevent default browser/webview overscroll behaviors
        e.preventDefault();

        if (wheelTimeoutId) {
          window.clearTimeout(wheelTimeoutId);
        }

        const children = getChildren();
        if (children.length === 0) return;

        // Apply dynamic liquid transition for active scrolls (smooths mouse wheel steps)
        children.forEach(child => {
          child.style.transition = 'transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          child.style.transformOrigin = isAtTop ? 'top' : 'bottom';
        });

        // Calculate progress-based dynamic resistance (tighter boundary drag)
        const progress = Math.abs(overscroll) / maxOverscroll;
        const dynamicResistance = resistance * (1 - progress * 0.8);

        // Displace overscroll value
        overscroll += -e.deltaY * dynamicResistance;

        // Clamp to defined threshold
        if (overscroll > maxOverscroll) overscroll = maxOverscroll;
        if (overscroll < -maxOverscroll) overscroll = -maxOverscroll;

        // Rubber-band scaling factor: stretches up to 5%
        const scaleVal = 1 + (Math.abs(overscroll) / maxOverscroll) * 0.05;

        // Apply transformations
        children.forEach(child => {
          child.style.transform = `translateY(${overscroll}px) scaleY(${scaleVal})`;
        });

        // Debounce spring restoration once scrolling stops
        wheelTimeoutId = window.setTimeout(resetOverscroll, 120);
      } else if (overscroll !== 0) {
        // Instantly spring back if scrolling direction shifts
        resetOverscroll();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const isAtTop = scrollTop <= 0;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if (isAtTop || isAtBottom) {
        isTouchActive = true;
        lastTouchY = e.touches[0].clientY;
        
        getChildren().forEach(child => {
          child.style.transition = 'transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          child.style.transformOrigin = isAtTop ? 'top' : 'bottom';
        });
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTouchActive) return;

      const currentTouchY = e.touches[0].clientY;
      const deltaY = currentTouchY - lastTouchY;
      lastTouchY = currentTouchY;

      const { scrollTop, scrollHeight, clientHeight } = el;
      const isAtTop = scrollTop <= 0;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

      const isDraggingDown = deltaY > 0;
      const isDraggingUp = deltaY < 0;

      if ((isAtTop && isDraggingDown) || (isAtBottom && isDraggingUp)) {
        if (e.cancelable) {
          e.preventDefault();
        }

        const children = getChildren();
        if (children.length === 0) return;

        const progress = Math.abs(overscroll) / maxOverscroll;
        const dynamicResistance = resistance * (1 - progress * 0.8);

        overscroll += deltaY * dynamicResistance;

        if (overscroll > maxOverscroll) overscroll = maxOverscroll;
        if (overscroll < -maxOverscroll) overscroll = -maxOverscroll;

        const scaleVal = 1 + (Math.abs(overscroll) / maxOverscroll) * 0.05;

        children.forEach(child => {
          child.style.transform = `translateY(${overscroll}px) scaleY(${scaleVal})`;
        });
      } else if (overscroll !== 0) {
        isTouchActive = false;
        resetOverscroll();
      }
    };

    const handleTouchEnd = () => {
      if (isTouchActive) {
        isTouchActive = false;
        resetOverscroll();
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    cleanupRef.current = () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      if (wheelTimeoutId) window.clearTimeout(wheelTimeoutId);
    };
  }, [resistance, maxOverscroll, tension]);

  return refCallback;
}
