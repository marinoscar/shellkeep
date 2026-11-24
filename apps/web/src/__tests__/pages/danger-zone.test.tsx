/**
 * Issue #69: the packaged Danger Zone and factory reset pages over ShellKeep's registrations. This renders the
 * REAL pages over MSW answering as the API does with ShellKeep's categories, scopes and factory reset steps:
 * the three ShellKeep categories show their counts, the two narrow scopes are rows under "Delete specific data"
 * (each disabled at zero), the phrase must be typed exactly, and the factory reset page prints the ShellKeep
 * step lines.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { FactoryResetPage, UserDangerZonePage } from '@marinoscar/platform-web/user-data/ui';
import { renderWithProviders as render, mockAdminUser } from '../utils/test-utils';
import { server } from '../mocks/server';

const USER_SUMMARY = {
  categories: [
    { id: 'servers', label: 'Servers', description: 'Server profiles and their saved credentials.', content: true, count: 3, bytes: null },
    { id: 'sessions', label: 'Terminal sessions', description: 'Terminal session records and their saved logs.', content: true, count: 5, bytes: null },
    { id: 'runbooks', label: 'Runbooks', description: 'Runbooks you own, their versions, runs and collected artifacts.', content: true, count: 0, bytes: null },
  ],
  scopes: [
    {
      id: 'servers',
      label: 'Delete my servers and sessions',
      description: 'Every server profile with its saved credentials, and every terminal session.',
      layer: 'specific',
      confirmation: 'SERVERS',
      categories: ['servers', 'sessions'],
    },
    {
      id: 'runbooks',
      label: 'Delete my runbooks and run history',
      description: 'Every runbook only you own.',
      layer: 'specific',
      confirmation: 'RUNBOOKS',
      categories: ['runbooks'],
    },
    { id: 'everything', label: 'Delete all my data', description: 'All.', layer: 'danger', confirmation: 'DELETE MY DATA', categories: ['servers', 'sessions', 'runbooks'] },
  ],
  kept: ['Your account, your sign-in identities and your roles'],
};

const RESET_SUMMARY = {
  disabledReason: null,
  otherUsers: 2,
  organizations: 0,
  storageObjects: 1,
  jobs: 4,
  categories: [],
  deleted: [
    'Every other user, their sessions and their access tokens',
    'Live terminal connections are closed; tmux sessions already running on your servers are not killed.',
    'Every server profile and its saved credentials',
  ],
  kept: ['Your account and this session', 'Database backups'],
};

describe('the Danger Zone and factory reset over ShellKeep registrations (#69)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(
      http.get('*/api/user-data/summary', () => HttpResponse.json({ data: USER_SUMMARY })),
      http.get('*/api/admin/factory-reset/summary', () => HttpResponse.json({ data: RESET_SUMMARY })),
    );
  });

  it('shows the three ShellKeep categories with counts and the two narrow scopes', async () => {
    render(<UserDangerZonePage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByText('Servers: 3');
    expect(screen.getByText('Terminal sessions: 5')).toBeInTheDocument();
    expect(screen.getByText('Runbooks: 0')).toBeInTheDocument();
    expect(screen.getByText('Delete my servers and sessions')).toBeInTheDocument();
    expect(screen.getByText('Delete my runbooks and run history')).toBeInTheDocument();
    // A scope with nothing to delete cannot be started; one with rows can.
    const runbooksRow = screen.getByText('Delete my runbooks and run history').closest('.MuiPaper-root') as HTMLElement;
    expect(within(runbooksRow).getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('keeps the confirm button off until the SERVERS phrase is typed exactly', async () => {
    const user = userEvent.setup();
    render(<UserDangerZonePage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByText('Servers: 3');
    const serversRow = screen.getByText('Delete my servers and sessions').closest('.MuiPaper-root') as HTMLElement;
    await user.click(within(serversRow).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.type(within(dialog).getByRole('textbox'), 'servers');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByRole('textbox'));
    await user.type(within(dialog).getByRole('textbox'), 'SERVERS');
    expect(confirm).toBeEnabled();
  });

  it('prints the ShellKeep factory reset step lines in what is deleted', async () => {
    render(<FactoryResetPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByText('Other users: 2');
    const deleted = within(screen.getByRole('list', { name: 'What is deleted' }));
    expect(deleted.getByText('Live terminal connections are closed; tmux sessions already running on your servers are not killed.')).toBeInTheDocument();
    expect(deleted.getByText('Every server profile and its saved credentials')).toBeInTheDocument();
  });
});
