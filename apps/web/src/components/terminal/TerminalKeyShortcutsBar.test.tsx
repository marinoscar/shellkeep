import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../__tests__/utils/test-utils';
import { TerminalKeyShortcutsBar } from './TerminalKeyShortcutsBar';
import { ALL_OFF } from '../../lib/terminal/keys/modifierState';
import { LONG_PRESS_MS } from './useLongPress';
import { DEFAULT_KEY_LAYOUT, type KeyLayout } from '../../lib/terminal/keys/keyModel';
import { resolveKeyGroups, type KeyActionId } from '../../lib/terminal/keys/keyRow';
import { layoutFromLegacyShortcuts } from '../../lib/terminal/keys/legacyAdapter';

// =============================================================================
// The accessory row (#167, evolved from the v1 key bar): the v2 layout as one
// continuous scroller with group dividers and spans, the pinned panel toggle,
// each key kind, and the #166 modifier toggles and long-press pop-ups.
// =============================================================================

const TEST_LAYOUT: KeyLayout = {
  groups: [
    { keys: [{ id: 'ai' }, { id: 'attach-file' }, { id: 'arrow-drag' }, { id: 'snippets' }] },
    { keys: [{ id: 'shift+tab' }, { id: 'esc' }, { id: 'ctrl' }] },
    { keys: [{ id: 'alt' }, { id: 'shift' }, { id: 'right' }] },
    {
      keys: [
        {
          key: {
            kind: 'macro',
            id: '00000000-0000-4000-8000-000000000001',
            label: 'Ctrl+B O',
            chords: [
              { modifiers: ['ctrl'], key: 'b' },
              { modifiers: [], key: 'o' },
            ],
          },
        },
        { key: { kind: 'custom', id: '00000000-0000-4000-8000-000000000002', label: 'Word', sequence: '\\e[1;5C' } },
      ],
    },
  ],
};

const ACTIONS = new Set<KeyActionId>(['ai', 'attach-file']);

function renderBar(props: Partial<Parameters<typeof TerminalKeyShortcutsBar>[0]> = {}) {
  const onKey = vi.fn();
  const onAction = vi.fn();
  const onToggleModifier = vi.fn();
  const onSendChord = vi.fn();
  const onTogglePanel = vi.fn();
  const utils = render(
    <TerminalKeyShortcutsBar
      open
      groups={resolveKeyGroups(TEST_LAYOUT, ACTIONS)}
      onKey={onKey}
      onAction={onAction}
      modifierState={ALL_OFF}
      onToggleModifier={onToggleModifier}
      onSendChord={onSendChord}
      onTogglePanel={onTogglePanel}
      panelId="panel-1"
      {...props}
    />,
  );
  return { ...utils, onKey, onAction, onToggleModifier, onSendChord, onTogglePanel };
}

const key = (name: string) => screen.getByRole('button', { name });

function longPress(element: HTMLElement) {
  fireEvent.pointerDown(element, { clientX: 10, clientY: 10, button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  fireEvent.pointerUp(element);
  fireEvent.click(element);
}

describe('TerminalKeyShortcutsBar: the accessory row (#167)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while closed (unmountOnExit)', () => {
    renderBar({ open: false });
    expect(screen.queryByRole('toolbar', { name: 'Terminal keys' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Key panel' })).not.toBeInTheDocument();
  });

  it('draws the layout as one row, in group order, with a divider between groups', () => {
    renderBar();
    const row = screen.getByRole('toolbar', { name: 'Terminal keys' });
    const names = within(row)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual([
      'Open AI assistant',
      'Attach a file',
      'Shift+Tab',
      'Esc',
      'Ctrl',
      'Alt',
      'Shift',
      '→',
      'Ctrl+B O',
      'Word',
    ]);
    expect(within(row).getAllByTestId('key-group-divider')).toHaveLength(3);
    // Dividers sit only at group boundaries.
    expect(within(row).getAllByTestId('key-group-divider')[0].previousElementSibling).toHaveAttribute(
      'data-action',
      'attach-file',
    );
  });

  it('gives a span-2 key the width of two targets', () => {
    renderBar();
    expect(key('Shift+Tab')).toHaveAttribute('data-span', '2');
    expect(key('Ctrl+B O')).toHaveAttribute('data-span', '2');
    expect(key('Esc')).toHaveAttribute('data-span', '1');
    expect(getComputedStyle(key('Shift+Tab')).minWidth).toBe('96px');
    expect(getComputedStyle(key('Esc')).minWidth).toBe('44px');
  });

  it('pins the panel toggle outside the scroller, labelled and expandable', async () => {
    const { onTogglePanel } = renderBar();
    const row = screen.getByRole('toolbar', { name: 'Terminal keys' });
    const toggle = key('Key panel');
    expect(row).not.toContainElement(toggle);
    expect(screen.getByTestId('terminal-key-row').lastElementChild).toContainElement(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    await userEvent.click(toggle);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it('marks the toggle expanded and controlling the panel while it is open', () => {
    renderBar({ panelOpen: true });
    expect(key('Key panel')).toHaveAttribute('aria-expanded', 'true');
    expect(key('Key panel')).toHaveAttribute('aria-controls', 'panel-1');
    expect(key('Key panel')).toHaveAttribute('id', 'panel-1-toggle');
  });

  it('draws no toggle without onTogglePanel', () => {
    renderBar({ onTogglePanel: undefined });
    expect(screen.queryByRole('button', { name: 'Key panel' })).not.toBeInTheDocument();
  });

  it('sends keys, macros and custom keys through onKey', async () => {
    const { onKey } = renderBar();
    await userEvent.click(key('Esc'));
    await userEvent.click(key('Ctrl+B O'));
    await userEvent.click(key('Word'));
    expect(onKey.mock.calls.map(([k]) => [k.kind, k.label])).toEqual([
      ['key', 'Esc'],
      ['macro', 'Ctrl+B O'],
      ['custom', 'Word'],
    ]);
  });

  it('marks repeatable keys for hold-to-repeat (#168)', () => {
    renderBar();
    expect(key('→')).toHaveAttribute('data-repeatable', 'true');
    expect(key('Esc')).not.toHaveAttribute('data-repeatable');
  });

  it('runs action keys through onAction and keeps the AI key name', async () => {
    const { onAction, onKey } = renderBar();
    await userEvent.click(key('Open AI assistant'));
    await userEvent.click(key('Attach a file'));
    expect(onAction.mock.calls).toEqual([['ai'], ['attach-file']]);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('hides the actions the host does not offer', () => {
    renderBar({ groups: resolveKeyGroups(TEST_LAYOUT, new Set()) });
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach a file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arrow drag' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snippets' })).not.toBeInTheDocument();
  });

  it('shows the help text with a Settings link for an empty layout', () => {
    renderBar({ groups: [] });
    expect(screen.getByText(/No shortcuts configured/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings/shortcuts');
  });

  it('draws only the toggle while the layout loads', () => {
    renderBar({ groups: null });
    expect(screen.queryByText(/No shortcuts configured/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('toolbar')).queryAllByRole('button')).toHaveLength(0);
    expect(key('Key panel')).toBeInTheDocument();
  });

  it('draws the default layout with the Ctrl and Alt toggles for a user migrated from v1 shortcuts', () => {
    const layout = layoutFromLegacyShortcuts([
      { id: 'sc-1', label: 'Deploy', keystrokes: [{ modifiers: [], key: 'd' }] },
    ]);
    renderBar({ groups: resolveKeyGroups(layout, new Set()) });
    expect(key('Ctrl')).toHaveAttribute('aria-pressed', 'false');
    expect(key('Alt')).toHaveAttribute('aria-pressed', 'false');
    expect(key('Deploy')).toBeInTheDocument();
  });

  it('keeps the default layout complete (every non-action key drawn)', () => {
    renderBar({ groups: resolveKeyGroups(DEFAULT_KEY_LAYOUT, new Set()) });
    expect(key('F12')).toBeInTheDocument();
    expect(key('Ctrl+B "')).toBeInTheDocument();
  });
});

describe('TerminalKeyShortcutsBar: modifier toggles and pop-ups (#166)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws no toggles without onToggleModifier', () => {
    renderBar({ onToggleModifier: undefined });
    expect(screen.queryByRole('button', { name: 'Ctrl' })).not.toBeInTheDocument();
  });

  it('draws the toggles off, with aria-pressed false and no description', () => {
    renderBar();
    for (const name of ['Ctrl', 'Alt', 'Shift']) {
      expect(key(name)).toHaveAttribute('aria-pressed', 'false');
      expect(key(name)).not.toHaveAccessibleDescription();
      expect(key(name)).toHaveAttribute('data-state', 'off');
    }
  });

  it('a tap toggles the modifier and does not send a key', async () => {
    const { onToggleModifier, onKey } = renderBar();
    await userEvent.click(key('Ctrl'));
    expect(onToggleModifier).toHaveBeenCalledWith('ctrl');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('shows armed and locked states with aria-pressed and a description', () => {
    renderBar({ modifierState: { ...ALL_OFF, ctrl: 'armed', alt: 'locked' } });
    expect(key('Ctrl')).toHaveAttribute('aria-pressed', 'true');
    expect(key('Ctrl')).toHaveAccessibleDescription('armed');
    expect(screen.queryByTestId('modifier-lock-ctrl')).not.toBeInTheDocument();
    expect(key('Alt')).toHaveAccessibleDescription('locked');
    expect(screen.getByTestId('modifier-lock-alt')).toBeInTheDocument();
    expect(key('Shift')).toHaveAttribute('aria-pressed', 'false');
  });

  it('a long press on Ctrl opens its pop-up without toggling Ctrl', () => {
    vi.useFakeTimers();
    const { onToggleModifier } = renderBar();
    longPress(key('Ctrl'));
    expect(onToggleModifier).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Ctrl combinations' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Ctrl+C', 'Ctrl+D', 'Ctrl+Z', 'Ctrl+R', 'Ctrl+L', 'Ctrl+A', 'Ctrl+E', 'Ctrl+W', 'Ctrl+U', 'Ctrl+K',
    ]);
  });

  it('a short press does not open a pop-up', () => {
    vi.useFakeTimers();
    const { onToggleModifier } = renderBar();
    const ctrl = key('Ctrl');
    fireEvent.pointerDown(ctrl, { clientX: 10, clientY: 10, button: 0 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    });
    fireEvent.pointerUp(ctrl);
    fireEvent.click(ctrl);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onToggleModifier).toHaveBeenCalledWith('ctrl');
  });

  it('moving during the press cancels the long press', () => {
    vi.useFakeTimers();
    renderBar();
    const ctrl = key('Ctrl');
    fireEvent.pointerDown(ctrl, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(ctrl, { clientX: 40, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('choosing a Ctrl entry sends its chord and closes the pop-up', () => {
    vi.useFakeTimers();
    const { onSendChord } = renderBar();
    longPress(key('Ctrl'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ctrl+R' }));
    expect(onSendChord).toHaveBeenCalledWith({ modifiers: ['ctrl'], key: 'r' });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Alt pops up Alt+B, Alt+F and Alt+.', () => {
    vi.useFakeTimers();
    const { onSendChord } = renderBar();
    longPress(key('Alt'));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Alt+B', 'Alt+F', 'Alt+.']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alt+.' }));
    expect(onSendChord).toHaveBeenCalledWith({ modifiers: ['alt'], key: '.' });
  });

  it('an arrow pops up the navigation keys, and the long press does not send the arrow', () => {
    vi.useFakeTimers();
    const { onKey, onSendChord } = renderBar();
    longPress(key('→'));
    expect(onKey).not.toHaveBeenCalled();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Home', 'End', 'PgUp', 'PgDn']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'PgDn' }));
    expect(onSendChord).toHaveBeenCalledWith({ modifiers: [], key: 'PageDown' });
  });

  it('Shift and non-arrow keys have no pop-up', () => {
    vi.useFakeTimers();
    renderBar();
    expect(key('Shift')).not.toHaveAttribute('aria-haspopup');
    expect(key('Esc')).not.toHaveAttribute('aria-haspopup');
    longPress(key('Esc'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('the pop-up opens from the keyboard (Shift+F10) and closes on Escape', async () => {
    renderBar();
    const ctrl = key('Ctrl');
    expect(ctrl).toHaveAttribute('aria-haspopup', 'menu');
    ctrl.focus();
    fireEvent.keyDown(ctrl, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('no pop-ups without onSendChord', () => {
    vi.useFakeTimers();
    renderBar({ onSendChord: undefined });
    longPress(key('Ctrl'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  describe('haptics', () => {
    const vibrate = vi.fn();
    beforeEach(() => {
      vibrate.mockReset();
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    });
    afterEach(() => {
      delete (navigator as { vibrate?: unknown }).vibrate;
    });

    it('vibrates 10 ms on a toggle when enabled', async () => {
      renderBar({ haptics: true });
      await userEvent.click(key('Alt'));
      expect(vibrate).toHaveBeenCalledWith(10);
    });

    it('does not vibrate when disabled', async () => {
      renderBar({ haptics: false });
      await userEvent.click(key('Alt'));
      expect(vibrate).not.toHaveBeenCalled();
    });

    it('does nothing where vibrate is unsupported', async () => {
      delete (navigator as { vibrate?: unknown }).vibrate;
      const { onToggleModifier } = renderBar({ haptics: true });
      await userEvent.click(key('Alt'));
      expect(onToggleModifier).toHaveBeenCalledWith('alt');
    });
  });
});
