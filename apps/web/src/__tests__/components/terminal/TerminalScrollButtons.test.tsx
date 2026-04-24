import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { TerminalScrollButtons } from '../../../components/terminal/TerminalScrollButtons';

// ---------------------------------------------------------------------------
// JSDOM polyfill — JSDOM does not implement setPointerCapture/releasePointerCapture.
// The component calls these unconditionally, so we stub them as no-ops here.
// ---------------------------------------------------------------------------
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a real DOM container node with a .xterm-viewport child attached to
 * document.body, and returns both nodes plus the RefObject shape the component
 * expects.  The caller must detach the container in afterEach/cleanup.
 */
function createContainerWithViewport() {
  const container = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'xterm-viewport';
  container.appendChild(viewport);
  document.body.appendChild(container);

  const containerRef = { current: container };
  return { container, viewport, containerRef };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalScrollButtons', () => {
  let container: HTMLDivElement;
  let viewport: HTMLDivElement;
  let containerRef: { current: HTMLDivElement | null };

  beforeEach(() => {
    const nodes = createContainerWithViewport();
    container = nodes.container;
    viewport = nodes.viewport;
    containerRef = nodes.containerRef;
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  describe('visible={false}', () => {
    it('renders null — container has no child element', () => {
      const { container: renderContainer } = render(
        <TerminalScrollButtons containerRef={containerRef} visible={false} />,
      );

      expect(renderContainer.firstChild).toBeNull();
    });
  });

  describe('visible={true}', () => {
    it('renders the "Scroll up" and "Scroll down" buttons', () => {
      const { getByLabelText } = render(
        <TerminalScrollButtons containerRef={containerRef} visible={true} />,
      );

      expect(getByLabelText('Scroll up')).toBeInTheDocument();
      expect(getByLabelText('Scroll down')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // WheelEvent dispatch — up button
  // -------------------------------------------------------------------------

  describe('up button dispatches a WheelEvent with negative deltaY', () => {
    it('fires a wheel event on .xterm-viewport with deltaY < 0 and DOM_DELTA_PIXEL mode', () => {
      const { getByLabelText } = render(
        <TerminalScrollButtons containerRef={containerRef} visible={true} />,
      );

      const upButton = getByLabelText('Scroll up');
      const received: WheelEvent[] = [];
      viewport.addEventListener('wheel', (e) => received.push(e as WheelEvent));

      fireEvent.pointerDown(upButton);

      expect(received).toHaveLength(1);
      expect(received[0].deltaY).toBeLessThan(0);
      expect(received[0].deltaMode).toBe(WheelEvent.DOM_DELTA_PIXEL);
    });
  });

  // -------------------------------------------------------------------------
  // WheelEvent dispatch — down button
  // -------------------------------------------------------------------------

  describe('down button dispatches a WheelEvent with positive deltaY', () => {
    it('fires a wheel event on .xterm-viewport with deltaY > 0 and DOM_DELTA_PIXEL mode', () => {
      const { getByLabelText } = render(
        <TerminalScrollButtons containerRef={containerRef} visible={true} />,
      );

      const downButton = getByLabelText('Scroll down');
      const received: WheelEvent[] = [];
      viewport.addEventListener('wheel', (e) => received.push(e as WheelEvent));

      fireEvent.pointerDown(downButton);

      expect(received).toHaveLength(1);
      expect(received[0].deltaY).toBeGreaterThan(0);
      expect(received[0].deltaMode).toBe(WheelEvent.DOM_DELTA_PIXEL);
    });
  });

  // -------------------------------------------------------------------------
  // Hold-to-repeat behaviour
  // -------------------------------------------------------------------------

  describe('hold-to-repeat on up button', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('dispatches ≥2 events after 400 ms (1 immediate + ≥1 from interval after 300 ms delay)', () => {
      const { getByLabelText } = render(
        <TerminalScrollButtons containerRef={containerRef} visible={true} />,
      );

      const upButton = getByLabelText('Scroll up');
      const received: WheelEvent[] = [];
      viewport.addEventListener('wheel', (e) => received.push(e as WheelEvent));

      // Hold down
      fireEvent.pointerDown(upButton);

      // One immediate dispatch should have happened already
      expect(received.length).toBe(1);

      // Advance past the 300 ms initial delay and at least one 70 ms interval
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(received.length).toBeGreaterThanOrEqual(2);

      // Release — no further dispatches after pointerUp
      fireEvent.pointerUp(upButton);
      const countAfterRelease = received.length;

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(received.length).toBe(countAfterRelease);
    });
  });

  describe('hold-to-repeat on down button', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('dispatches ≥2 events after 400 ms and stops after pointerUp', () => {
      const { getByLabelText } = render(
        <TerminalScrollButtons containerRef={containerRef} visible={true} />,
      );

      const downButton = getByLabelText('Scroll down');
      const received: WheelEvent[] = [];
      viewport.addEventListener('wheel', (e) => received.push(e as WheelEvent));

      fireEvent.pointerDown(downButton);
      expect(received.length).toBe(1);

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(received.length).toBeGreaterThanOrEqual(2);

      // All events should have positive deltaY
      received.forEach((ev) => {
        expect(ev.deltaY).toBeGreaterThan(0);
      });

      fireEvent.pointerUp(downButton);
      const countAfterRelease = received.length;

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(received.length).toBe(countAfterRelease);
    });
  });
});
