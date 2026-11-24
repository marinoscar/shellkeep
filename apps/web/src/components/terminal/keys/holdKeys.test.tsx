import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { render } from '../../../__tests__/utils/test-utils';
import { TerminalKeyShortcutsBar } from '../TerminalKeyShortcutsBar';
import { TerminalKeyPanel } from './TerminalKeyPanel';
import { ARROW_DRAG_HINT } from './TouchKey';
import { SWIPE_UP_PX } from './useKeyRepeat';
import { LONG_PRESS_MS } from '../useLongPress';
import { createModifierStore, type ModifierStore } from '../../../lib/terminal/keys/modifierState';
import { createHeldKeySender, REPEAT_DELAY_MS } from '../../../lib/terminal/keys/arrowRepeat';
import { resolveKeyGroups, type KeyActionId } from '../../../lib/terminal/keys/keyRow';
import type { KeyLayout } from '../../../lib/terminal/keys/keyModel';

// =============================================================================
// Hold-to-repeat and the arrow-drag key (#168) in the accessory row and the
// key panel, over a real held-key sender and modifier store.
// =============================================================================

const LAYOUT: KeyLayout = {
  groups: [
    { keys: [{ id: 'arrow-drag' }, { id: 'ctrl' }, { id: 'alt' }] },
    { keys: [{ id: 'left' }, { id: 'down' }, { id: 'up' }, { id: 'right' }] },
    { keys: [{ id: 'home' }, { id: 'delete' }, { id: 'esc' }] },
    { keys: [{ id: 'backspace' }] },
  ],
};
const ACTIONS = new Set<KeyActionId>(['arrow-drag']);
const groups = resolveKeyGroups(LAYOUT, ACTIONS);

interface Harness {
  store: ModifierStore;
  write: ReturnType<typeof vi.fn>;
  onKey: ReturnType<typeof vi.fn>;
  onSendChord: ReturnType<typeof vi.fn>;
  app: { on: boolean };
}

function harness(): Harness {
  return { store: createModifierStore(), write: vi.fn(), onKey: vi.fn(), onSendChord: vi.fn(), app: { on: false } };
}

function handlersOf(h: Harness, haptics = false) {
  return {
    onKey: h.onKey,
    onAction: vi.fn(),
    onToggleModifier: (m: 'ctrl' | 'alt' | 'shift' | 'meta') => h.store.tap(m),
    onSendChord: h.onSendChord,
    modifierState: h.store.getSnapshot(),
    haptics,
    beginHold: () =>
      createHeldKeySender({ modifiers: h.store, applicationCursor: () => h.app.on, write: h.write }),
  };
}

function renderRow(h: Harness, haptics = false) {
  return render(<TerminalKeyShortcutsBar open groups={groups} {...handlersOf(h, haptics)} />);
}

function renderPanel(h: Harness) {
  return render(
    <TerminalKeyPanel id="kp" variant="side" groups={groups} onClose={vi.fn()} {...handlersOf(h)} />,
  );
}

const key = (name: string) => screen.getByRole('button', { name });
const sent = (h: Harness) => h.write.mock.calls.map((c) => c[0] as string);
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('hold-to-repeat (#168)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a tap sends once, on release, through the normal key path', () => {
    const h = harness();
    renderRow(h);
    const right = key('→');
    expect(right).toHaveAttribute('data-repeatable', 'true');
    fireEvent.pointerDown(right, { clientX: 10, clientY: 10, button: 0 });
    advance(100);
    fireEvent.pointerUp(right);
    fireEvent.click(right);
    expect(h.onKey).toHaveBeenCalledTimes(1);
    expect(h.onKey.mock.calls[0][0]).toMatchObject({ catalogId: 'right' });
    expect(h.write).not.toHaveBeenCalled();
  });

  it('a hold sends after 400 ms, then repeats faster and faster, and the ending click is ignored', () => {
    const h = harness();
    renderRow(h);
    const right = key('→');
    fireEvent.pointerDown(right, { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS - 1);
    expect(h.write).not.toHaveBeenCalled();
    advance(1);
    expect(sent(h)).toEqual(['\x1b[C']);
    advance(80);
    expect(h.write).toHaveBeenCalledTimes(2);
    advance(75);
    expect(h.write).toHaveBeenCalledTimes(3);
    advance(70 + 65 + 60);
    expect(h.write).toHaveBeenCalledTimes(6);
    // After acceleration: one per 30 ms.
    advance(2000);
    const count = h.write.mock.calls.length;
    advance(300);
    expect(h.write.mock.calls.length - count).toBe(10);
    fireEvent.pointerUp(right);
    fireEvent.click(right);
    expect(h.onKey).not.toHaveBeenCalled();
    advance(1000);
    expect(h.write.mock.calls.length - count).toBe(10);
  });

  it.each([
    ['pointer cancel', (el: HTMLElement) => fireEvent.pointerCancel(el)],
    ['pointer leave', (el: HTMLElement) => fireEvent.pointerLeave(el)],
    ['page hide', () => window.dispatchEvent(new Event('pagehide'))],
    [
      'hidden page',
      () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      },
    ],
  ])('stops on %s', (_name, stopWith) => {
    const h = harness();
    renderRow(h);
    const del = key('Del');
    fireEvent.pointerDown(del, { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS + 80);
    expect(sent(h)).toEqual(['\x1b[3~', '\x1b[3~']);
    act(() => stopWith(del));
    advance(1000);
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it('stops on unmount', () => {
    const h = harness();
    const { unmount } = renderRow(h);
    fireEvent.pointerDown(key('Home'), { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS);
    expect(sent(h)).toEqual(['\x1b[H']);
    unmount();
    advance(1000);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('a slide before the repeat starts is a scroll of the row: nothing repeats', () => {
    const h = harness();
    renderRow(h);
    const left = key('←');
    fireEvent.pointerDown(left, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(left, { clientX: 40, clientY: 12 });
    advance(1000);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('applies an armed one-shot to the whole held repeat and releases it at the end', () => {
    const h = harness();
    renderRow(h);
    fireEvent.click(key('Ctrl'));
    expect(h.store.getSnapshot().ctrl).toBe('armed');
    const left = key('←');
    fireEvent.pointerDown(left, { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS + 80 + 75);
    expect(sent(h)).toEqual(['\x1b[1;5D', '\x1b[1;5D', '\x1b[1;5D']);
    expect(h.store.getSnapshot().ctrl).toBe('armed');
    fireEvent.pointerUp(left);
    expect(h.store.getSnapshot().ctrl).toBe('off');
  });

  it('keeps a locked modifier after the hold', () => {
    const h = harness();
    h.store = createModifierStore({ now: () => 0 });
    renderRow(h);
    h.store.tap('alt');
    h.store.tap('alt');
    const bs = key('Backspace');
    fireEvent.pointerDown(bs, { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS);
    fireEvent.pointerUp(bs);
    expect(sent(h)).toEqual(['\x1b\x7f']);
    expect(h.store.getSnapshot().alt).toBe('locked');
  });

  it('sends the application cursor form of a held arrow', () => {
    const h = harness();
    h.app.on = true;
    renderRow(h);
    const up = key('↑');
    fireEvent.pointerDown(up, { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS + 80);
    fireEvent.pointerUp(up);
    expect(sent(h)).toEqual(['\x1bOA', '\x1bOA']);
  });

  it('repeats in the key panel too', () => {
    const h = harness();
    renderPanel(h);
    const panel = screen.getByRole('region', { name: 'Key panel' });
    const down = within(panel).getByRole('button', { name: '↓' });
    fireEvent.pointerDown(down, { clientX: 10, clientY: 10, button: 0 });
    advance(REPEAT_DELAY_MS + 80);
    fireEvent.pointerUp(down);
    expect(sent(h)).toEqual(['\x1b[B', '\x1b[B']);
  });
});

describe("an arrow's alternatives with hold-to-repeat (#168)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a long hold repeats and never opens the pop-up, even with the platform context menu', () => {
    const h = harness();
    renderRow(h);
    const right = key('→');
    fireEvent.pointerDown(right, { clientX: 10, clientY: 10, button: 0 });
    advance(LONG_PRESS_MS + 200);
    fireEvent.contextMenu(right);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.pointerUp(right);
    expect(h.write.mock.calls.length).toBeGreaterThan(1);
  });

  it('an upward swipe on the key opens the navigation pop-up without sending', () => {
    const h = harness();
    renderRow(h);
    const right = key('→');
    expect(right).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.pointerDown(right, { clientX: 10, clientY: 40, button: 0 });
    fireEvent.pointerMove(right, { clientX: 12, clientY: 40 - SWIPE_UP_PX });
    fireEvent.pointerUp(right);
    fireEvent.click(right);
    const menu = screen.getByRole('menu', { name: 'Navigation keys' });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.onKey).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'End' }));
    expect(h.onSendChord).toHaveBeenCalledWith({ modifiers: [], key: 'End' });
  });

  it('right-click and Shift+F10 open the pop-up', () => {
    const h = harness();
    renderRow(h);
    fireEvent.contextMenu(key('←'));
    expect(screen.getByRole('menu', { name: 'Navigation keys' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    advance(500);
    fireEvent.keyDown(key('↓'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Navigation keys' })).toBeInTheDocument();
  });

  it('Ctrl keeps its long-press pop-up', () => {
    const h = harness();
    renderRow(h);
    const ctrl = key('Ctrl');
    fireEvent.pointerDown(ctrl, { clientX: 10, clientY: 10, button: 0 });
    advance(LONG_PRESS_MS);
    expect(screen.getByRole('menu', { name: 'Ctrl combinations' })).toBeInTheDocument();
  });
});

describe('the arrow-drag key (#168)', () => {
  const vibrate = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vibrate.mockReset();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  it('is drawn in the row and the panel, only with a hold source', () => {
    const h = harness();
    const { unmount } = renderRow(h);
    expect(key('Arrow drag')).toHaveAttribute('data-action', 'arrow-drag');
    unmount();
    render(<TerminalKeyShortcutsBar open groups={groups} {...handlersOf(h)} beginHold={undefined} />);
    expect(screen.queryByRole('button', { name: 'Arrow drag' })).not.toBeInTheDocument();
  });

  it('sends arrows in the dominant direction at three gears, and release stops', () => {
    const h = harness();
    renderRow(h);
    const drag = key('Arrow drag');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(drag, { clientX: 105, clientY: 100 });
    advance(1000);
    expect(h.write).not.toHaveBeenCalled();

    fireEvent.pointerMove(drag, { clientX: 120, clientY: 104 });
    expect(drag).toHaveAttribute('data-direction', 'right');
    expect(drag).toHaveAttribute('data-gear', '1');
    advance(1000);
    expect(h.write.mock.calls.length).toBe(7); // one at once, then ~6 a second
    expect(new Set(sent(h))).toEqual(new Set(['\x1b[C']));

    h.write.mockClear();
    fireEvent.pointerMove(drag, { clientX: 100, clientY: 145 });
    expect(drag).toHaveAttribute('data-direction', 'down');
    expect(drag).toHaveAttribute('data-gear', '2');
    advance(1000);
    expect(h.write.mock.calls.length).toBe(15);
    expect(new Set(sent(h))).toEqual(new Set(['\x1b[B']));

    h.write.mockClear();
    fireEvent.pointerMove(drag, { clientX: 10, clientY: 100 });
    expect(drag).toHaveAttribute('data-gear', '3');
    advance(1000);
    expect(h.write.mock.calls.length).toBeGreaterThanOrEqual(34);
    expect(new Set(sent(h))).toEqual(new Set(['\x1b[D']));

    fireEvent.pointerUp(drag);
    h.write.mockClear();
    advance(1000);
    expect(h.write).not.toHaveBeenCalled();
    expect(drag).not.toHaveAttribute('data-dragging');
  });

  it('applies the cursor mode and an armed modifier to the drag, releasing it at the end', () => {
    const h = harness();
    renderRow(h);
    const drag = key('Arrow drag');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 100, clientY: 80 });
    fireEvent.pointerUp(drag);
    h.app.on = true;
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 100, clientY: 80 });
    fireEvent.pointerUp(drag);
    expect(sent(h)).toEqual(['\x1b[A', '\x1bOA']);

    h.write.mockClear();
    h.store.tap('shift');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 70, clientY: 100 });
    advance(200);
    expect(h.store.getSnapshot().shift).toBe('armed');
    fireEvent.pointerUp(drag);
    expect(new Set(sent(h))).toEqual(new Set(['\x1b[1;2D']));
    expect(h.store.getSnapshot().shift).toBe('off');
  });

  it('a tap without a drag sends nothing, keeps the modifiers and shows the hint', () => {
    const h = harness();
    renderRow(h);
    h.store.tap('ctrl');
    const drag = key('Arrow drag');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(drag);
    fireEvent.click(drag);
    expect(h.write).not.toHaveBeenCalled();
    expect(h.store.getSnapshot().ctrl).toBe('armed');
    expect(screen.getByRole('tooltip')).toHaveTextContent(ARROW_DRAG_HINT);
  });

  it('a cancelled pointer stops the drag', () => {
    const h = harness();
    renderRow(h);
    const drag = key('Arrow drag');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 150, clientY: 100 });
    fireEvent.pointerCancel(drag);
    h.write.mockClear();
    advance(1000);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('ticks on each gear change only with haptics on', () => {
    const h = harness();
    const { unmount } = renderRow(h, true);
    let drag = key('Arrow drag');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 115, clientY: 100 });
    fireEvent.pointerMove(drag, { clientX: 145, clientY: 100 });
    fireEvent.pointerMove(drag, { clientX: 190, clientY: 100 });
    fireEvent.pointerUp(drag);
    expect(vibrate).toHaveBeenCalledTimes(3);
    unmount();

    vibrate.mockReset();
    renderRow(harness(), false);
    drag = key('Arrow drag');
    fireEvent.pointerDown(drag, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(drag, { clientX: 190, clientY: 100 });
    fireEvent.pointerUp(drag);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
