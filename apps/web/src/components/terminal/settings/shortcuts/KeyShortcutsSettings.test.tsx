import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../../__tests__/utils/test-utils';
import { KeyShortcutsSettings } from './KeyShortcutsSettings';
import type { KeyShortcut } from '../../../../types/terminal';

// ---------------------------------------------------------------------------
// Props (the page owns the settings hook and hands the list in)
// ---------------------------------------------------------------------------

const mockOnSave = vi.fn();

const sampleShortcut: KeyShortcut = {
  id: 'shortcut-1',
  label: 'Ctrl-C',
  keystrokes: [{ modifiers: ['ctrl'], key: 'c' }],
};

// ---------------------------------------------------------------------------
// Mock KeystrokeEditor to avoid rendering its internals
// ---------------------------------------------------------------------------

vi.mock('./KeystrokeEditor', () => ({
  KeystrokeEditor: ({ value, onChange, disabled }: {
    value: { modifiers: string[]; key: string };
    onChange: (next: { modifiers: string[]; key: string }) => void;
    onRemove?: () => void;
    disabled?: boolean;
  }) => (
    <div data-testid="keystroke-editor" data-key={value.key} data-disabled={disabled ? 'true' : 'false'}>
      <span>{value.modifiers.join('+')}{value.modifiers.length ? '+' : ''}{value.key}</span>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function setup(shortcuts: KeyShortcut[] = [sampleShortcut]) {
  mockOnSave.mockResolvedValue(undefined);
  return { shortcuts, onSave: mockOnSave };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeyShortcutsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('Rendering existing shortcuts', () => {
    it('renders the section heading', () => {
      render(<KeyShortcutsSettings {...setup()} />);

      expect(screen.getByText('Key Shortcuts')).toBeInTheDocument();
    });

    it('renders the label of the existing shortcut', () => {
      render(<KeyShortcutsSettings {...setup()} />);

      // The label TextField is rendered with value="Ctrl-C"
      const labelInput = screen.getByDisplayValue('Ctrl-C');
      expect(labelInput).toBeInTheDocument();
    });

    it('renders "Add shortcut" button', () => {
      render(<KeyShortcutsSettings {...setup()} />);

      expect(screen.getByRole('button', { name: /add shortcut/i })).toBeInTheDocument();
    });

    it('Save Changes button is disabled when not dirty', () => {
      render(<KeyShortcutsSettings {...setup()} />);

      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });

    it('Reset button is disabled when not dirty', () => {
      render(<KeyShortcutsSettings {...setup()} />);

      expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Add shortcut
  // -------------------------------------------------------------------------

  describe('Add shortcut', () => {
    it('clicking "Add shortcut" appends a new row', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      // Initially one label input ("Ctrl-C")
      expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: /add shortcut/i }));

      // Now two label inputs
      await waitFor(() => {
        expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(2);
      });
    });

    it('new shortcut has default label "New"', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      await user.click(screen.getByRole('button', { name: /add shortcut/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('New')).toBeInTheDocument();
      });
    });

    it('Save Changes becomes enabled after adding a shortcut', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      await user.click(screen.getByRole('button', { name: /add shortcut/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Delete shortcut
  // -------------------------------------------------------------------------

  describe('Delete shortcut', () => {
    it('clicking delete removes the shortcut row', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      // One row initially
      expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(1);

      const deleteBtn = screen.getByRole('button', { name: /delete shortcut 1/i });
      await user.click(deleteBtn);

      // Row removed — label input is gone
      await waitFor(() => {
        expect(screen.queryByDisplayValue('Ctrl-C')).not.toBeInTheDocument();
      });
    });

    it('Save Changes becomes enabled after deleting a shortcut', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      const deleteBtn = screen.getByRole('button', { name: /delete shortcut 1/i });
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Save (with label edit)
  // -------------------------------------------------------------------------

  describe('Save', () => {
    it('calls onSave with the shortcuts containing the edited label', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      // Edit the existing shortcut label
      const labelInput = screen.getByDisplayValue('Ctrl-C');
      await user.clear(labelInput);
      await user.type(labelInput, 'Interrupt');

      // Save button should now be enabled
      const saveBtn = screen.getByRole('button', { name: /save changes/i });
      await waitFor(() => expect(saveBtn).toBeEnabled());

      await user.click(saveBtn);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.arrayContaining([expect.objectContaining({ label: 'Interrupt' })]),
        );
      });
    });

    it('Save button is enabled only when dirty', async () => {
      const user = userEvent.setup();
      render(<KeyShortcutsSettings {...setup()} />);

      const saveBtn = screen.getByRole('button', { name: /save changes/i });
      expect(saveBtn).toBeDisabled();

      const labelInput = screen.getByDisplayValue('Ctrl-C');
      await user.type(labelInput, '!');

      await waitFor(() => expect(saveBtn).toBeEnabled());
    });
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  describe('Empty state', () => {
    it('renders no label inputs when shortcuts list is empty', () => {
      render(<KeyShortcutsSettings {...setup([])} />);

      expect(screen.queryByLabelText(/shortcut \d+ label/i)).not.toBeInTheDocument();
    });

    it('Add shortcut button is still visible when list is empty', () => {
      render(<KeyShortcutsSettings {...setup([])} />);

      expect(screen.getByRole('button', { name: /add shortcut/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  describe('Disabled prop', () => {
    it('disables all interactive controls when disabled={true}', () => {
      render(<KeyShortcutsSettings {...setup()} disabled />);

      expect(screen.getByRole('button', { name: /add shortcut/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /delete shortcut 1/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });
  });
});
