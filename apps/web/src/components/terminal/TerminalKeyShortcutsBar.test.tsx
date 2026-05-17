import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../__tests__/utils/test-utils';
import { TerminalKeyShortcutsBar } from './TerminalKeyShortcutsBar';
import type { KeyShortcut } from '../../types';

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
      expect(settingsLink).toHaveAttribute('href', '/settings');
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
});
