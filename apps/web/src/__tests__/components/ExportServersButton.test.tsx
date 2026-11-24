import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../utils/test-utils';
import { server } from '../mocks/server';
import { ExportServersButton } from '../../components/server-profiles/ExportServersButton';

const SERVER_PROFILES_SOURCE = {
  id: 'server-profiles',
  scope: 'user',
  label: 'Server profiles',
  description: 'Your SSH server profiles. Passwords, private keys and passphrases are never exported.',
  formats: [
    { id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' },
    { id: 'csv', label: 'CSV (zip)', extension: 'zip', mimeType: 'application/zip' },
  ],
  fields: [{ key: 'includeShared', label: 'Include shared', kind: 'boolean', required: false }],
};

const USER_DATA_SOURCE = {
  id: 'user-data',
  scope: 'user',
  label: 'My data',
  formats: [{ id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json' }],
  fields: [],
};

describe('ExportServersButton', () => {
  it('draws nothing when the API offers the caller no server-profiles source', async () => {
    server.use(http.get('*/api/exports/sources', () => HttpResponse.json({ data: { items: [USER_DATA_SOURCE] } })));
    render(<ExportServersButton />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('opens the export dialog preset to server-profiles and queues the export', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    let posted: unknown = null;
    server.use(
      http.get('*/api/exports/sources', () =>
        HttpResponse.json({ data: { items: [USER_DATA_SOURCE, SERVER_PROFILES_SOURCE] } }),
      ),
      http.post('*/api/exports', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            data: {
              id: '11111111-1111-4111-8111-111111111111',
              status: 'pending',
              source: 'server-profiles',
              format: 'json',
              scope: 'user',
              createdAt: '2026-11-24T10:00:00.000Z',
              download: null,
            },
          },
          { status: 202 },
        );
      }),
    );
    render(<ExportServersButton onCreated={onCreated} />);

    await user.click(await screen.findByRole('button', { name: /^export$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/server profiles/i);
    expect(dialog).toHaveTextContent(/never exported/i);

    await user.click(screen.getByRole('button', { name: /^(start export|export|request export)$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted).toMatchObject({ source: 'server-profiles', format: 'json' });
  });
});
