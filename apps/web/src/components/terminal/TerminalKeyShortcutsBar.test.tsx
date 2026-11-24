import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../__tests__/utils/test-utils';
import { TerminalKeyShortcutsBar } from './TerminalKeyShortcutsBar';
import type { KeyShortcut } from '../../types';
import { ALL_OFF } from '../../lib/terminal/keys/modifierState';
import { LONG_PRESS_MS } from './useLongPress';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const shortcut1: KeyShortcut = {
  id: 'sc-1',
  label: 'Ctrl-C',
  keystrokes: [{ modifiers: ['ctrl'], key: 'c' }],
};

const shortcut2: KeyShortcut = {
  id: 'sc-2',
  label: 'Escape',
  keystrokes: [{ modifiers: [], key: 'Escape' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalKeyShortcutsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // open={false}
  // -------------------------------------------------------------------------

  describe('when open={false}', () => {
    it('does not render the chip strip content (unmountOnExit)', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open={false} shortcuts={[shortcut1, shortcut2]} onSend={onSend} />,
      );

      // Chips should not be in the DOM at all because Collapse uses unmountOnExit
      expect(screen.queryByRole('button', { name: 'Ctrl-C' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Escape' })).not.toBeInTheDocument();
    });

    it('does not render the empty-state help text', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open={false} shortcuts={[]} onSend={onSend} />,
      );

      expect(screen.queryByText(/no shortcuts configured/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // open={true} with shortcuts
  // -------------------------------------------------------------------------

  describe('when open={true} with shortcuts', () => {
    it('renders a chip for each shortcut', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[shortcut1, shortcut2]} onSend={onSend} />,
      );

      expect(screen.getByText('Ctrl-C')).toBeInTheDocument();
      expect(screen.getByText('Escape')).toBeInTheDocument();
    });

    it('each chip is clickable', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[shortcut1, shortcut2]} onSend={onSend} />,
      );

      // MUI Chip with clickable renders a <div role="button"> wrapping the label
      const ctrlCChip = screen.getByText('Ctrl-C').closest('[role="button"]') as HTMLElement;
      expect(ctrlCChip).toBeInTheDocument();

      await user.click(ctrlCChip);

      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith(shortcut1);
    });

    it('clicking each chip calls onSend with the corresponding shortcut object', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[shortcut1, shortcut2]} onSend={onSend} />,
      );

      const escChip = screen.getByText('Escape').closest('[role="button"]') as HTMLElement;
      await user.click(escChip);

      expect(onSend).toHaveBeenCalledWith(shortcut2);
    });

    it('does not render the empty-state help text when shortcuts are present', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[shortcut1]} onSend={onSend} />,
      );

      expect(screen.queryByText(/no shortcuts configured/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // open={true} with empty shortcuts
  // -------------------------------------------------------------------------

  describe('when open={true} with shortcuts=[]', () => {
    it('renders the help text', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[]} onSend={onSend} />,
      );

      expect(screen.getByText(/no shortcuts configured/i)).toBeInTheDocument();
    });

    it('renders a link to Settings in the help text', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[]} onSend={onSend} />,
      );

      const settingsLink = screen.getByRole('link', { name: /settings/i });
      expect(settingsLink).toBeInTheDocument();
      expect(settingsLink).toHaveAttribute('href', '/settings/shortcuts');
    });

    it('renders no chip buttons', () => {
      const onSend = vi.fn();
      render(
        <TerminalKeyShortcutsBar open shortcuts={[]} onSend={onSend} />,
      );

      // No clickable chips
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
  });

  it('draws an AI key only when the assistant is available, and it opens the assistant', async () => {
    const onAiAssist = vi.fn();
    const { rerender } = render(<TerminalKeyShortcutsBar open shortcuts={[shortcut1]} onSend={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).not.toBeInTheDocument();
    rerender(<TerminalKeyShortcutsBar open shortcuts={[shortcut1]} onSend={vi.fn()} onAiAssist={onAiAssist} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open AI assistant' }));
    expect(onAiAssist).toHaveBeenCalledTimes(1);
  });
  // -------------------------------------------------------------------------
  // Modifier toggles and long-press pop-ups (#166)
  // -------------------------------------------------------------------------

  describe('modifier toggles (#166)', () => {
    const right: KeyShortcut = { id: 'right', label: '→', keystrokes: [{ modifiers: [], key: 'ArrowRight' }] };

    function renderBar(props: Partial<Parameters<typeof TerminalKeyShortcutsBar>[0]> = {}) {
      const onSend = vi.fn();
      const onToggleModifier = vi.fn();
      const onSendChord = vi.fn();
      const utils = render(
        <TerminalKeyShortcutsBar
          open
          shortcuts={[shortcut2, right]}
          onSend={onSend}
          modifierKeys={['ctrl', 'alt', 'shift']}
          modifierState={ALL_OFF}
          onToggleModifier={onToggleModifier}
          onSendChord={onSendChord}
          {...props}
        />,
      );
      return { ...utils, onSend, onToggleModifier, onSendChord };
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

    afterEach(() => {
      vi.useRealTimers();
    });

    it('draws no toggles without onToggleModifier', () => {
      render(<TerminalKeyShortcutsBar open shortcuts={[shortcut1]} onSend={vi.fn()} modifierKeys={['ctrl']} />);
      expect(screen.queryByRole('button', { name: 'Ctrl' })).not.toBeInTheDocument();
    });

    it('draws the toggles in order, off, with aria-pressed false and no description', () => {
      renderBar();
      for (const name of ['Ctrl', 'Alt', 'Shift']) {
        expect(key(name)).toHaveAttribute('aria-pressed', 'false');
        expect(key(name)).not.toHaveAccessibleDescription();
        expect(key(name)).toHaveAttribute('data-state', 'off');
      }
    });

    it('a tap toggles the modifier and does not send a key', async () => {
      const { onToggleModifier, onSend } = renderBar();
      await userEvent.click(key('Ctrl'));
      expect(onToggleModifier).toHaveBeenCalledWith('ctrl');
      expect(onSend).not.toHaveBeenCalled();
    });

    it('shows armed and locked states with aria-pressed and a description', () => {
      renderBar({ modifierState: { ...ALL_OFF, ctrl: 'armed', alt: 'locked' } });
      expect(key('Ctrl')).toHaveAttribute('aria-pressed', 'true');
      expect(key('Ctrl')).toHaveAccessibleDescription('armed');
      expect(key('Ctrl')).toHaveAttribute('data-state', 'armed');
      expect(screen.queryByTestId('modifier-lock-ctrl')).not.toBeInTheDocument();
      expect(key('Alt')).toHaveAttribute('aria-pressed', 'true');
      expect(key('Alt')).toHaveAccessibleDescription('locked');
      expect(screen.getByTestId('modifier-lock-alt')).toBeInTheDocument();
      expect(key('Shift')).toHaveAttribute('aria-pressed', 'false');
    });

    it('a long press on Ctrl opens its pop-up without toggling Ctrl', () => {
      vi.useFakeTimers();
      const { onToggleModifier } = renderBar();
      longPress(key('Ctrl'));
      expect(onToggleModifier).not.toHaveBeenCalled();
      const menu = screen.getByRole('menu', { name: 'Ctrl combinations' });
      expect(menu).toBeInTheDocument();
      const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
      expect(items).toEqual([
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

    it('an arrow pops up Home, End, PgUp and PgDn, and the long press does not send the arrow', () => {
      vi.useFakeTimers();
      const { onSend, onSendChord } = renderBar();
      longPress(key('→'));
      expect(onSend).not.toHaveBeenCalled();
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Home', 'End', 'PgUp', 'PgDn']);
      fireEvent.click(screen.getByRole('menuitem', { name: 'PgDn' }));
      expect(onSendChord).toHaveBeenCalledWith({ modifiers: [], key: 'PageDown' });
    });

    it('Shift and non-arrow keys have no pop-up', () => {
      vi.useFakeTimers();
      renderBar();
      expect(key('Shift')).not.toHaveAttribute('aria-haspopup');
      expect(key('Escape')).not.toHaveAttribute('aria-haspopup');
      longPress(key('Escape'));
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
});
