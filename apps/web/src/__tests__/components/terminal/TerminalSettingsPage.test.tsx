import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { mockUserSettings } from '../../mocks/data';
import { DEFAULT_TERMINAL_SETTINGS } from '../../../lib/terminal/settings';

// The preview's xterm: a stand-in that records the options it is given.
const { terminals } = vi.hoisted(() => ({
  terminals: [] as { options: Record<string, unknown>; write: ReturnType<typeof vi.fn> }[],
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = { ...options };
    this.open = vi.fn();
    this.write = vi.fn();
    this.loadAddon = vi.fn();
    this.dispose = vi.fn();
    terminals.push(this as never);
  }),
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function (this: Record<string, unknown>) {
    this.fit = vi.fn();
  }),
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalSettingsPage } from '../../../components/terminal/settings/TerminalSettingsPage';

type Body = { terminal?: Record<string, unknown>; shortcuts?: unknown };

function capturePatches() {
  const bodies: Body[] = [];
  let version = mockUserSettings.version;
  server.use(
    http.patch('*/api/user-settings', async ({ request }) => {
      const body = (await request.json()) as Body;
      bodies.push(body);
      version += 1;
      return HttpResponse.json({ data: { ...mockUserSettings, ...body, version } });
    }),
  );
  return bodies;
}

describe('TerminalSettingsPage', () => {
  beforeEach(() => {
    terminals.length = 0;
  });

  it('shows every preference with its default for a user with nothing stored', async () => {
    render(<TerminalSettingsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /show scroll buttons/i })).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Font size' })).toHaveValue('14');
    expect(screen.getByRole('slider', { name: 'Scrollback' })).toHaveValue('10000');
    expect(screen.getByRole('radio', { name: 'On touch screens' })).toBeChecked();
    expect(screen.getByRole('switch', { name: /blinking cursor/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /copy selected text/i })).not.toBeChecked();
    // The shortcuts are their own card now.
    expect(screen.queryByLabelText(/shortcut \d+ label/i)).not.toBeInTheDocument();
  });

  it('updates the preview and saves the whole namespace when the font size changes', async () => {
    const bodies = capturePatches();
    render(<TerminalSettingsPage />);

    const slider = await screen.findByRole('slider', { name: 'Font size' });
    fireEvent.change(slider, { target: { value: '18' } });

    // The preview follows at once, its xterm included...
    expect(screen.getByTestId('terminal-preview')).toHaveAttribute('data-font-size', '18');
    await waitFor(() => expect(terminals[0]?.options.fontSize).toBe(18));
    // ...and the change saves itself.
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18 } });
    expect(bodies[0]).not.toHaveProperty('shortcuts');
  });

  it('applies the chosen colour theme to the preview', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    render(<TerminalSettingsPage />);

    await user.click(await screen.findByRole('combobox', { name: 'Colour theme' }));
    await user.click(screen.getByRole('option', { name: 'Solarized dark' }));

    expect(screen.getByTestId('terminal-preview')).toHaveAttribute('data-theme', 'solarized-dark');
    await waitFor(() =>
      expect(terminals[0]?.options.theme).toEqual(expect.objectContaining({ background: '#002b36' })),
    );
    await waitFor(() => expect(bodies[0]?.terminal?.theme).toBe('solarized-dark'));
  });

  it('saves the scroll-buttons switch and the key bar mode', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    render(<TerminalSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: /show scroll buttons/i }));
    await user.click(screen.getByRole('radio', { name: 'Never' }));

    await waitFor(() =>
      expect(bodies.at(-1)?.terminal).toEqual(
        expect.objectContaining({ showScrollButtons: false, showKeyBar: 'never' }),
      ),
    );
  });

  it('reads stored preferences', async () => {
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: { ...mockUserSettings, terminal: { showScrollButtons: false, fontSize: 22, bell: 'visual' } },
        }),
      ),
    );
    render(<TerminalSettingsPage />);

    expect(await screen.findByRole('slider', { name: 'Font size' })).toHaveValue('22');
    expect(screen.getByRole('switch', { name: /show scroll buttons/i })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Bell' })).toHaveTextContent('Flash the terminal');
  });
});
