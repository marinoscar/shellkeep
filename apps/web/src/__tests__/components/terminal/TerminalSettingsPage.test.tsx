import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { mockUserSettings } from '../../mocks/data';
import { TerminalSettingsPage } from '../../../components/terminal/settings/TerminalSettingsPage';

describe('TerminalSettingsPage', () => {
  it('shows the default scroll buttons and nine shortcuts for a user with nothing stored', async () => {
    render(<TerminalSettingsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /show scroll buttons/i })).toBeChecked();
    expect(screen.getAllByLabelText(/shortcut \d+ label/i)).toHaveLength(9);
    expect(screen.getByDisplayValue('ESC')).toBeInTheDocument();
  });

  it('saves the scroll-buttons switch as the whole terminal namespace', async () => {
    const user = userEvent.setup();
    let body: { terminal?: { showScrollButtons: boolean; keyShortcuts: unknown[] } } | null = null;
    server.use(
      http.patch('*/api/user-settings', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          data: { ...mockUserSettings, ...body, version: mockUserSettings.version + 1 },
        });
      }),
    );
    render(<TerminalSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: /show scroll buttons/i }));

    await waitFor(() => expect(body?.terminal?.showScrollButtons).toBe(false));
    expect(body!.terminal!.keyShortcuts).toHaveLength(9);
    expect(await screen.findByText('Scroll buttons hidden')).toBeInTheDocument();
  });

  it('saves an edited shortcut list', async () => {
    const user = userEvent.setup();
    let body: { terminal?: { keyShortcuts: { label: string }[] } } | null = null;
    server.use(
      http.patch('*/api/user-settings', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          data: { ...mockUserSettings, ...body, version: mockUserSettings.version + 1 },
        });
      }),
    );
    render(<TerminalSettingsPage />);

    const label = await screen.findByDisplayValue('ESC');
    await user.clear(label);
    await user.type(label, 'Escape');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body?.terminal?.keyShortcuts[0].label).toBe('Escape'));
    expect(await screen.findByText('Key shortcuts saved')).toBeInTheDocument();
  });
});
