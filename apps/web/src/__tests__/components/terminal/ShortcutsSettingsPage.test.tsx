import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { mockUserSettings } from '../../mocks/data';
import { ShortcutsSettingsPage } from '../../../components/terminal/settings/ShortcutsSettingsPage';
import { DEFAULT_KEY_SHORTCUTS } from '../../../lib/terminal/settings';
import { encodeShortcut, formatEncodedBytes } from '../../../lib/terminal/encodeKeystroke';
import type { KeyShortcut } from '../../../types/terminal';

const legacy: KeyShortcut = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+R',
  keystrokes: [{ modifiers: ['ctrl'], key: 'r' }],
};

type Body = { shortcuts?: { keyShortcuts: KeyShortcut[] }; terminal?: unknown };

function capturePatches() {
  const bodies: Body[] = [];
  server.use(
    http.patch('*/api/user-settings', async ({ request }) => {
      const body = (await request.json()) as Body;
      bodies.push(body);
      return HttpResponse.json({
        data: { ...mockUserSettings, ...body, version: mockUserSettings.version + 1 },
      });
    }),
  );
  return bodies;
}

describe('ShortcutsSettingsPage', () => {
  it('shows the nine default shortcuts and the bytes each sends', async () => {
    render(<ShortcutsSettingsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(9);
    expect(screen.getByLabelText('shortcut 1 bytes')).toHaveTextContent('Sends: \\x1b');
    // Ctrl+C is ETX; the up arrow is CSI A.
    expect(screen.getByLabelText('shortcut 4 bytes')).toHaveTextContent('Sends: \\x03');
    expect(screen.getByLabelText('shortcut 6 bytes')).toHaveTextContent('Sends: \\x1b[A');
  });

  it('shows a legacy terminal.keyShortcuts list unchanged (the shim, #80)', async () => {
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: { ...mockUserSettings, terminal: { showScrollButtons: true, keyShortcuts: [legacy] } },
        }),
      ),
    );
    render(<ShortcutsSettingsPage />);

    expect(await screen.findByDisplayValue('Ctrl+R')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(1);
    expect(screen.getByLabelText('shortcut 1 bytes')).toHaveTextContent(
      `Sends: ${formatEncodedBytes(encodeShortcut(legacy))}`,
    );
  });

  it('round-trips an edited keystroke through encodeKeystroke and saves it to the shortcuts namespace', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    render(<ShortcutsSettingsPage />);

    // Shortcut 1 is a bare Escape; tick Ctrl and pick the letter "a": Ctrl+A is SOH.
    const first = (await screen.findByLabelText('shortcut 1 label')).closest('.MuiStack-root') as HTMLElement;
    await user.click(within(first).getByRole('checkbox', { name: /ctrl/i }));
    await user.click(within(first).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'A' }));

    expect(screen.getByLabelText('shortcut 1 bytes')).toHaveTextContent('Sends: \\x01');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    const saved = bodies[0].shortcuts!.keyShortcuts[0];
    expect(saved.keystrokes).toEqual([{ modifiers: ['ctrl'], key: 'a' }]);
    expect(encodeShortcut(saved)).toBe('\x01');
    expect(bodies[0]).not.toHaveProperty('terminal');
    expect(await screen.findByText('Key shortcuts saved')).toBeInTheDocument();
  });

  it('restores the built-in list', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({ data: { ...mockUserSettings, shortcuts: { keyShortcuts: [legacy] } } }),
      ),
    );
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: /restore defaults/i }));
    expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(9);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(bodies[0]?.shortcuts?.keyShortcuts).toEqual(DEFAULT_KEY_SHORTCUTS));
  });
});
