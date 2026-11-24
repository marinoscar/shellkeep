import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import type { IBufferCell, IBufferLine } from '@xterm/xterm';

const { statRemoteFile } = vi.hoisted(() => ({ statRemoteFile: vi.fn() }));
vi.mock('../../../services/files-api', () => ({ statRemoteFile }));

import {
  ARROW_MODE_LONG_PRESS_MS,
  ARROW_MODE_MOVE_TOLERANCE,
  useTerminalArrowMode,
} from '../../../components/terminal/useTerminalArrowMode';
import { useTerminalFileLinks, LONG_PRESS_MS as LINK_LONG_PRESS_MS } from '../../../components/terminal/files/useTerminalFileLinks';
import { useTouchScroll } from '../../../hooks/useTouchScroll';
import { createHeldKeySender } from '../../../lib/terminal/keys/arrowRepeat';
import { createModifierStore, type ModifierStore } from '../../../lib/terminal/keys/modifierState';
import type { FileLinkTerminal } from '../../../lib/terminal/file-link-provider';

// =============================================================================
// Long-press-and-drag arrow mode on the terminal (#168), wired as TerminalView
// wires it: beside the unchanged useTouchScroll and the file links (#155).
// =============================================================================

/** A 20x2 terminal at (0,0), 10 px per column and 20 px per row, showing `text` on row 0. */
function fakeTerminal(text: string): FileLinkTerminal {
  const cols = 20;
  const line = {
    isWrapped: false,
    length: cols,
    getCell: (x: number) => ({ getChars: () => (text[x] ?? '').trim(), getWidth: () => 1 }) as unknown as IBufferCell,
  } as unknown as IBufferLine;
  const element = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 40 }) as DOMRect;
  element.appendChild(screen);
  return {
    cols,
    rows: 2,
    element,
    buffer: { active: { viewportY: 0, length: 1, getLine: (y: number) => (y === 0 ? line : undefined) } },
  };
}

function touch(target: HTMLElement, type: string, x: number, y: number, fingers = 1) {
  const point = { clientX: x, clientY: y, identifier: 0, target } as unknown as Touch;
  const ending = type === 'touchend' || type === 'touchcancel';
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', { value: ending ? [] : Array.from({ length: fingers }, () => point) });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('useTerminalArrowMode (#168)', () => {
  let wrapper: HTMLDivElement;
  let container: HTMLDivElement;
  let wheel: ReturnType<typeof vi.fn>;
  const terminal = fakeTerminal('cat /etc/hosts');
  const vibrate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wrapper = document.createElement('div');
    container = document.createElement('div');
    const viewport = document.createElement('div');
    viewport.className = 'xterm-viewport';
    container.appendChild(viewport);
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
    wheel = vi.fn();
    container.addEventListener('wheel', wheel);
    statRemoteFile.mockResolvedValue({ path: '/etc/hosts', type: 'file', isText: true });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  });
  afterEach(() => {
    vi.useRealTimers();
    wrapper.remove();
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  function renderTerminal(
    options: { haptics?: boolean; applicationCursor?: boolean; store?: ModifierStore; links?: boolean } = {},
  ) {
    const write = vi.fn();
    const hook = renderHook(() => {
      const wrapperRef = useRef<HTMLDivElement>(wrapper);
      const containerRef = useRef<HTMLDivElement>(container);
      const claimed = useRef<() => boolean>(() => false);
      useTouchScroll(containerRef);
      const links = useTerminalFileLinks(
        'sess-1',
        containerRef,
        () => terminal,
        options.links === false ? null : { profileId: 'prof-1' },
        { isTouchClaimed: () => claimed.current() },
      );
      const arrow = useTerminalArrowMode(wrapperRef, containerRef, {
        enabled: true,
        haptics: options.haptics ?? false,
        isLinkAt: links.isLinkAt,
        beginHold: () =>
          createHeldKeySender({
            modifiers: options.store,
            applicationCursor: () => options.applicationCursor ?? false,
            write,
          }),
      });
      claimed.current = arrow.isTouchClaimed;
      return { links, arrow };
    });
    return { ...hook, write };
  }

  it('a long press without movement enters arrow mode; a drag sends arrows; release ends it', () => {
    const { result, write } = renderTerminal();
    touch(container, 'touchstart', 150, 30);
    advance(ARROW_MODE_LONG_PRESS_MS - 1);
    expect(result.current.arrow.state).toBeNull();
    advance(1);
    expect(result.current.arrow.state).toEqual({ direction: null, gear: 0 });

    const move = touch(container, 'touchmove', 150, 30 - 45);
    expect(move.defaultPrevented).toBe(true);
    // The drag does not scroll: useTouchScroll never saw the move.
    expect(wheel).not.toHaveBeenCalled();
    expect(result.current.arrow.state).toEqual({ direction: 'up', gear: 2 });
    advance(1000);
    expect(write.mock.calls.length).toBe(16); // one at once, then 15 a second
    expect(new Set(write.mock.calls.map((c) => c[0]))).toEqual(new Set(['\x1b[A']));

    touch(container, 'touchend', 150, -15);
    expect(result.current.arrow.state).toBeNull();
    write.mockClear();
    advance(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it('small jitter under the tolerance still enters arrow mode', () => {
    const { result } = renderTerminal();
    touch(container, 'touchstart', 150, 30);
    touch(container, 'touchmove', 150 + ARROW_MODE_MOVE_TOLERANCE - 2, 30);
    advance(ARROW_MODE_LONG_PRESS_MS);
    expect(result.current.arrow.state).not.toBeNull();
  });

  it('a swipe that moves before the long press is a normal scroll', () => {
    const { result, write } = renderTerminal();
    touch(container, 'touchstart', 150, 30);
    advance(100);
    const move = touch(container, 'touchmove', 150, 60);
    expect(wheel).toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(true); // useTouchScroll's own preventDefault
    advance(1000);
    touch(container, 'touchmove', 150, 90);
    expect(result.current.arrow.state).toBeNull();
    touch(container, 'touchend', 150, 90);
    expect(write).not.toHaveBeenCalled();
  });

  it('applies the cursor mode and an armed modifier to the whole drag', () => {
    const store = createModifierStore();
    store.tap('ctrl');
    const { write } = renderTerminal({ applicationCursor: true, store });
    touch(container, 'touchstart', 150, 30);
    advance(ARROW_MODE_LONG_PRESS_MS);
    touch(container, 'touchmove', 120, 30);
    advance(400);
    expect(store.getSnapshot().ctrl).toBe('armed');
    touch(container, 'touchend', 120, 30);
    expect(new Set(write.mock.calls.map((c) => c[0]))).toEqual(new Set(['\x1b[1;5D']));
    expect(store.getSnapshot().ctrl).toBe('off');

    write.mockClear();
    touch(container, 'touchstart', 150, 30);
    advance(ARROW_MODE_LONG_PRESS_MS);
    touch(container, 'touchmove', 150, 50);
    touch(container, 'touchend', 150, 50);
    expect(write.mock.calls[0][0]).toBe('\x1bOB');
  });

  it('a second finger, a cancelled touch or a hidden page ends it', () => {
    const { result, write } = renderTerminal();
    for (const end of [
      () => touch(container, 'touchmove', 150, 0, 2),
      () => touch(container, 'touchcancel', 150, 0),
      () => act(() => window.dispatchEvent(new Event('pagehide'))),
    ]) {
      touch(container, 'touchstart', 150, 30);
      advance(ARROW_MODE_LONG_PRESS_MS);
      touch(container, 'touchmove', 150, 0);
      expect(result.current.arrow.state).not.toBeNull();
      end();
      expect(result.current.arrow.state).toBeNull();
      write.mockClear();
      advance(1000);
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('unmount stops it', () => {
    const { write, unmount } = renderTerminal();
    touch(container, 'touchstart', 150, 30);
    advance(ARROW_MODE_LONG_PRESS_MS);
    touch(container, 'touchmove', 150, 0);
    unmount();
    write.mockClear();
    advance(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it('a touch that starts outside the terminal never enters', () => {
    const { result } = renderTerminal();
    const sibling = document.createElement('button');
    wrapper.appendChild(sibling);
    touch(sibling, 'touchstart', 150, 30);
    advance(1000);
    expect(result.current.arrow.state).toBeNull();
  });

  it('a mouse never enters arrow mode (touch only)', () => {
    const { result } = renderTerminal();
    act(() => {
      container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 150, clientY: 30 }));
    });
    advance(1000);
    expect(result.current.arrow.state).toBeNull();
  });

  it('ticks on entering and on each gear change only with haptics on', () => {
    renderTerminal({ haptics: true });
    touch(container, 'touchstart', 150, 30);
    advance(ARROW_MODE_LONG_PRESS_MS);
    expect(vibrate).toHaveBeenCalledTimes(1);
    touch(container, 'touchmove', 165, 30);
    touch(container, 'touchmove', 195, 30);
    touch(container, 'touchmove', 240, 30);
    expect(vibrate).toHaveBeenCalledTimes(4);
    touch(container, 'touchend', 240, 30);
  });

  it('never vibrates with haptics off', () => {
    renderTerminal({ haptics: false });
    touch(container, 'touchstart', 150, 30);
    advance(ARROW_MODE_LONG_PRESS_MS);
    touch(container, 'touchmove', 240, 30);
    touch(container, 'touchend', 240, 30);
    expect(vibrate).not.toHaveBeenCalled();
  });

  describe('precedence with the file links (#155)', () => {
    async function underline() {
      // A first tap checks the path; once the stat answers, it is underlined.
      touch(container, 'touchstart', 55, 5);
      touch(container, 'touchend', 55, 5);
      await flush();
      expect(statRemoteFile).toHaveBeenCalledTimes(1);
    }

    it('a long press on an underlined link opens the file menu, not arrow mode', async () => {
      const { result } = renderTerminal();
      await underline();
      expect(result.current.links.isLinkAt(55, 5)).toBe(true);
      touch(container, 'touchstart', 55, 5);
      advance(LINK_LONG_PRESS_MS + 10);
      expect(result.current.arrow.state).toBeNull();
      touch(container, 'touchend', 55, 5);
      await flush();
      expect(result.current.links.menu?.link.reference.path).toBe('/etc/hosts');
    });

    it('a long press on a path not yet underlined enters arrow mode and opens no menu', async () => {
      const { result } = renderTerminal();
      expect(result.current.links.isLinkAt(55, 5)).toBe(false);
      touch(container, 'touchstart', 55, 5);
      advance(LINK_LONG_PRESS_MS + 10);
      expect(result.current.arrow.state).not.toBeNull();
      touch(container, 'touchend', 55, 5);
      await act(async () => {
        await Promise.resolve();
      });
      expect(statRemoteFile).not.toHaveBeenCalled();
      expect(result.current.links.menu).toBeNull();
    });

    it('a long press away from any link enters arrow mode', async () => {
      const { result } = renderTerminal();
      await underline();
      touch(container, 'touchstart', 15, 5);
      advance(ARROW_MODE_LONG_PRESS_MS);
      expect(result.current.links.isLinkAt(15, 5)).toBe(false);
      expect(result.current.arrow.state).not.toBeNull();
      touch(container, 'touchend', 15, 5);
      expect(result.current.links.menu).toBeNull();
    });

    it('a tap on an underlined link still opens the menu', async () => {
      const { result } = renderTerminal();
      await underline();
      touch(container, 'touchstart', 56, 6);
      advance(50);
      touch(container, 'touchend', 56, 6);
      await flush();
      expect(result.current.links.menu?.link.reference.path).toBe('/etc/hosts');
      expect(result.current.arrow.state).toBeNull();
    });
  });
});
