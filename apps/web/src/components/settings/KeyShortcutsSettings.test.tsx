import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../__tests__/utils/test-utils';
import { KeyShortcutsSettings } from './KeyShortcutsSettings';
import type { UserSettings } from '../../types';

// ---------------------------------------------------------------------------
// Mock useUserSettings
// ---------------------------------------------------------------------------

const mockUpdateSettings = vi.fn();

const sampleShortcut = {
  id: 'shortcut-1',
  label: 'Ctrl-C',
  keystrokes: [{ modifiers: ['ctrl' as const], key: 'c' as const }],
};

const makeSettings = (overrides: Partial<UserSettings> = {}): UserSettings => ({
  theme: 'system',
  profile: {
    displayName: 'Test User',
    useProviderImage: true,
    customImageUrl: null,
  },
  terminal: {
    showScrollButtons: true,
    keyShortcuts: [sampleShortcut],
  },
  updatedAt: new Date().toISOString(),
  version: 1,
  ...overrides,
});

vi.mock('../../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn(),
}));

import { useUserSettings } from '../../hooks/useUserSettings';

const mockUseUserSettings = vi.mocked(useUserSettings);

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

function setup(settingsOverride?: Partial<UserSettings>) {
  const settings = makeSettings(settingsOverride);
  mockUpdateSettings.mockResolvedValue(undefined);

  mockUseUserSettings.mockReturnValue({
    settings,
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings: mockUpdateSettings,
    updateTheme: vi.fn(),
    updateProfile: vi.fn(),
    refresh: vi.fn(),
  });

  return { settings };
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
      setup();
      render(<KeyShortcutsSettings />);

      expect(screen.getByText('Key Shortcuts')).toBeInTheDocument();
    });

    it('renders the label of the existing shortcut', () => {
      setup();
      render(<KeyShortcutsSettings />);

      // The label TextField is rendered with value="Ctrl-C"
      const labelInput = screen.getByDisplayValue('Ctrl-C');
      expect(labelInput).toBeInTheDocument();
    });

    it('renders "Add shortcut" button', () => {
      setup();
      render(<KeyShortcutsSettings />);

      expect(screen.getByRole('button', { name: /add shortcut/i })).toBeInTheDocument();
    });

    it('Save Changes button is disabled when not dirty', () => {
      setup();
      render(<KeyShortcutsSettings />);

      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });

    it('Reset button is disabled when not dirty', () => {
      setup();
      render(<KeyShortcutsSettings />);

      expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Add shortcut
  // -------------------------------------------------------------------------

  describe('Add shortcut', () => {
    it('clicking "Add shortcut" appends a new row', async () => {
      const user = userEvent.setup();
      setup();
      render(<KeyShortcutsSettings />);

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
      setup();
      render(<KeyShortcutsSettings />);

      await user.click(screen.getByRole('button', { name: /add shortcut/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('New')).toBeInTheDocument();
      });
    });

    it('Save Changes becomes enabled after adding a shortcut', async () => {
      const user = userEvent.setup();
      setup();
      render(<KeyShortcutsSettings />);

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
      setup();
      render(<KeyShortcutsSettings />);

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
      setup();
      render(<KeyShortcutsSettings />);

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
    it('calls updateSettings with terminal.keyShortcuts containing the edited label', async () => {
      const user = userEvent.setup();
      setup();
      render(<KeyShortcutsSettings />);

      // Edit the existing shortcut label
      const labelInput = screen.getByDisplayValue('Ctrl-C');
      await user.clear(labelInput);
      await user.type(labelInput, 'Interrupt');

      // Save button should now be enabled
      const saveBtn = screen.getByRole('button', { name: /save changes/i });
      await waitFor(() => expect(saveBtn).toBeEnabled());

      await user.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            terminal: expect.objectContaining({
              keyShortcuts: expect.arrayContaining([
                expect.objectContaining({ label: 'Interrupt' }),
              ]),
            }),
          }),
        );
      });
    });

    it('Save button is enabled only when dirty', async () => {
      const user = userEvent.setup();
      setup();
      render(<KeyShortcutsSettings />);

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
      setup({ terminal: { showScrollButtons: true, keyShortcuts: [] } });
      render(<KeyShortcutsSettings />);

      expect(screen.queryByLabelText(/shortcut \d+ label/i)).not.toBeInTheDocument();
    });

    it('Add shortcut button is still visible when list is empty', () => {
      setup({ terminal: { showScrollButtons: true, keyShortcuts: [] } });
      render(<KeyShortcutsSettings />);

      expect(screen.getByRole('button', { name: /add shortcut/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  describe('Disabled prop', () => {
    it('disables all interactive controls when disabled={true}', () => {
      setup();
      render(<KeyShortcutsSettings disabled />);

      expect(screen.getByRole('button', { name: /add shortcut/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /delete shortcut 1/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });
  });
});
