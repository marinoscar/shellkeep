import { type RefObject, useEffect } from 'react';

/**
 * Converts touch swipe gestures into synthetic WheelEvents for xterm.js terminal
 * scrolling on tablets. A 2.0x multiplier compensates for the smaller pixel
 * distances covered by finger swipes compared to mouse wheel ticks.
 */
export function useTouchScroll(containerRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let previousY = 0;

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;
      previousY = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;

      const currentY = e.touches[0].clientY;
      const deltaY = previousY - currentY;

      if (Math.abs(deltaY) < 2) return;

      const viewport = container.querySelector('.xterm-viewport');
      if (viewport) {
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: deltaY * 2.0,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          bubbles: true,
          cancelable: true,
        });
        viewport.dispatchEvent(wheelEvent);
      }

      e.preventDefault();
      previousY = currentY;
    };

    const handleTouchEnd = (): void => {
      previousY = 0;
    };

    container.addEventListener('touchstart', handleTouchStart);
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [containerRef]);
}
