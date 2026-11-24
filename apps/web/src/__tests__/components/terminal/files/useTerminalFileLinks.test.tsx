import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import type { IBufferCell, IBufferLine } from '@xterm/xterm';

const { statRemoteFile } = vi.hoisted(() => ({ statRemoteFile: vi.fn() }));
vi.mock('../../../../services/files-api', () => ({ statRemoteFile }));

import { useTerminalFileLinks, LONG_PRESS_MS } from '../../../../components/terminal/files/useTerminalFileLinks';
import { useTouchScroll } from '../../../../hooks/useTouchScroll';
import type { FileLinkTerminal } from '../../../../lib/terminal/file-link-provider';

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

function touch(target: HTMLElement, type: string, x: number, y: number) {
  const point = { clientX: x, clientY: y, identifier: 0, target } as unknown as Touch;
  const ending = type === 'touchend' || type === 'touchcancel';
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', { value: ending ? [] : [point] });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('useTerminalFileLinks (#155)', () => {
  let container: HTMLDivElement;
  const terminal = fakeTerminal('cat /etc/hosts');

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    // Where useTouchScroll sends its synthetic wheel events.
    const viewport = document.createElement('div');
    viewport.className = 'xterm-viewport';
    container.appendChild(viewport);
    document.body.appendChild(container);
    statRemoteFile.mockResolvedValue({ path: '/etc/hosts', type: 'file', isText: true });
  });
  afterEach(() => container.remove());

  function renderLinks(config: { profileId: string } | null = { profileId: 'prof-1' }) {
    return renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      // The terminal's own touch scrolling stays wired beside the links.
      useTouchScroll(ref);
      return useTerminalFileLinks('sess-1', ref, () => terminal, config);
    });
  }

  it('gives no source without a server', () => {
    const { result } = renderLinks(null);
    expect(result.current.source).toBeNull();
  });

  it('checks a path against the session with stat', async () => {
    const { result } = renderLinks();
    expect(await result.current.source!.resolve('./x.log')).toEqual({ path: '/etc/hosts', type: 'file', isText: true });
    expect(statRemoteFile).toHaveBeenCalledWith({ profileId: 'prof-1', path: './x.log', sessionId: 'sess-1' });
  });

  it('opens the menu where a link is clicked', async () => {
    const { result } = renderLinks();
    const link = {
      reference: { path: '/etc/hosts', start: 4, end: 14 },
      stat: { path: '/etc/hosts', type: 'file' as const },
      text: '/etc/hosts',
      range: { start: { x: 5, y: 1 }, end: { x: 14, y: 1 } },
    };
    act(() => result.current.source!.activate(link, { x: 50, y: 5 }, new MouseEvent('click')));
    expect(result.current.menu).toEqual({ link, anchor: { x: 50, y: 5 } });
    act(() => result.current.closeMenu());
    expect(result.current.menu).toBeNull();
  });

  it('a first tap only checks the path; a second tap on the underlined link opens the menu', async () => {
    const { result } = renderLinks();
    touch(container, 'touchstart', 55, 5);
    touch(container, 'touchend', 55, 5);
    expect(result.current.menu).toBeNull();
    await waitFor(() => expect(statRemoteFile).toHaveBeenCalledTimes(1));

    await act(async () => {
      await Promise.resolve();
    });
    touch(container, 'touchstart', 56, 6);
    touch(container, 'touchend', 56, 6);
    await waitFor(() => expect(result.current.menu?.link.reference.path).toBe('/etc/hosts'));
    expect(result.current.menu?.anchor).toEqual({ x: 56, y: 6 });
    expect(statRemoteFile).toHaveBeenCalledTimes(1);
  });

  it('a long-press opens the menu once the path is known', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { result } = renderLinks();
      touch(container, 'touchstart', 55, 5);
      vi.setSystemTime(Date.now() + LONG_PRESS_MS + 10);
      touch(container, 'touchend', 55, 5);
      await waitFor(() => expect(result.current.menu?.link.stat.path).toBe('/etc/hosts'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a swipe scrolls and never opens or checks anything', async () => {
    const { result } = renderLinks();
    const wheel = vi.fn();
    container.addEventListener('wheel', wheel);
    touch(container, 'touchstart', 55, 5);
    const move = touch(container, 'touchmove', 55, 40);
    touch(container, 'touchend', 55, 40);
    // useTouchScroll still turned the swipe into a scroll.
    expect(wheel).toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(true);
    expect(statRemoteFile).not.toHaveBeenCalled();
    expect(result.current.menu).toBeNull();
  });

  it('a tap away from a path does nothing', () => {
    const { result } = renderLinks();
    touch(container, 'touchstart', 15, 5);
    touch(container, 'touchend', 15, 5);
    expect(statRemoteFile).not.toHaveBeenCalled();
    expect(result.current.menu).toBeNull();
  });

  it('a tap on a path that does not exist opens nothing', async () => {
    statRemoteFile.mockRejectedValue(new Error('404'));
    const { result } = renderLinks();
    for (let i = 0; i < 2; i += 1) {
      touch(container, 'touchstart', 55, 5);
      touch(container, 'touchend', 55, 5);
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(statRemoteFile).toHaveBeenCalledTimes(1);
    expect(result.current.menu).toBeNull();
  });

  it('ignores the click the browser synthesises right after a tap', () => {
    const { result } = renderLinks();
    touch(container, 'touchstart', 15, 5);
    touch(container, 'touchend', 15, 5);
    const link = {
      reference: { path: '/etc/hosts', start: 4, end: 14 },
      stat: { path: '/etc/hosts', type: 'file' as const },
      text: '/etc/hosts',
      range: { start: { x: 5, y: 1 }, end: { x: 14, y: 1 } },
    };
    act(() => result.current.source!.activate(link, { x: 50, y: 5 }, new MouseEvent('click')));
    expect(result.current.menu).toBeNull();
  });
});
