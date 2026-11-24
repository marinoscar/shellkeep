import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../mocks/server';
import { render, mockUser } from '../../../utils/test-utils';
import { HOME, PROFILE, SESSION, CWD, fakeFilesHandlers, type ListRequest } from './fakeFiles';

vi.mock('../../../../components/files/viewer/FileViewerProvider', () => ({
  useOpenFile: () => ({ openFile: vi.fn(), closeFile: vi.fn() }),
}));

import { FileBrowser } from '../../../../components/files/browser/FileBrowser';

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:write'] };
const ARCHIVE = '33333333-3333-4333-8333-333333333333';

let state: { cwd: string; requests: ListRequest[] };
let requested: Array<{ profile: string; body: any }>;
/** What each status poll answers, in order; the last one repeats. */
let polls: any[];
let pollCount: number;
let downloads: string[];
let anchorClicks: Array<{ href: string; download: string }>;
let startFails: { status: number; code: string; message: string } | null;

const view = (extra: Record<string, unknown>) => ({
  archiveId: ARCHIVE,
  serverProfileId: PROFILE,
  path: `${HOME}/projects`,
  status: 'pending',
  sizeBytes: null,
  warning: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-11-24T10:00:00.000Z',
  finishedAt: null,
  expiresAt: '2026-11-25T10:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  state = { cwd: CWD, requests: [] };
  requested = [];
  polls = [view({ status: 'running' }), view({ status: 'ready', sizeBytes: 5 * 1024 * 1024 })];
  pollCount = 0;
  downloads = [];
  anchorClicks = [];
  startFails = null;
  server.use(
    ...fakeFilesHandlers(state),
    http.post('*/api/server-profiles/:id/files/archive', async ({ request, params }) => {
      requested.push({ profile: String(params.id), body: await request.json() });
      if (startFails) return HttpResponse.json(startFails, { status: startFails.status });
      return HttpResponse.json({ data: { archiveId: ARCHIVE, jobId: 'job-1', status: 'pending' } }, { status: 202 });
    }),
    http.get('*/api/files/archives/:id', () => HttpResponse.json({ data: polls[Math.min(pollCount++, polls.length - 1)] })),
    http.get('*/api/files/archives/:id/download', ({ params }) => {
      downloads.push(String(params.id));
      return HttpResponse.json({ data: { url: 'https://storage.example.test/a.tar.gz?sig=1', filename: 'projects.tar.gz', expiresAt: '2026-11-24T10:15:00.000Z' } });
    }),
  );
  // jsdom does not navigate; record the anchor the download clicks.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push({ href: this.href, download: this.download });
  });
});

afterEach(() => vi.restoreAllMocks());

async function renderBrowser(props: Partial<Parameters<typeof FileBrowser>[0]> = {}, user = writer) {
  const result = render(<FileBrowser profileId={PROFILE} {...props} />, { wrapperOptions: { user } });
  await screen.findByRole('list', { name: props.sessionId ? `Files in ${CWD}` : `Files in ${HOME}` });
  return result;
}

async function openFolderMenu(user: ReturnType<typeof userEvent.setup>, name = 'projects') {
  await user.click(screen.getByRole('button', { name: `More actions for ${name}` }));
  return screen.getByRole('menu', { name: `Actions for ${name}` });
}

describe('FileBrowser folder archives (#158)', () => {
  it('offers Download as archive on a folder only, and only with sessions:write', async () => {
    const user = userEvent.setup();
    await renderBrowser();
    const folderMenu = await openFolderMenu(user);
    expect(within(folderMenu).getByRole('menuitem', { name: 'Download as archive' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'More actions for notes.txt' }));
    const fileMenu = screen.getByRole('menu', { name: 'Actions for notes.txt' });
    expect(within(fileMenu).queryByRole('menuitem', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('hides it without sessions:write', async () => {
    const user = userEvent.setup();
    await renderBrowser({}, mockUser);
    const menu = await openFolderMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: /archive/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('archive-panel')).not.toBeInTheDocument();
  });

  it('starts the job, shows a pending state, then a Download button that fetches the signed link', async () => {
    const user = userEvent.setup();
    await renderBrowser({ sessionId: SESSION });
    const menu = await openFolderMenu(user, 'logs');
    await user.click(within(menu).getByRole('menuitem', { name: 'Download as archive' }));

    expect(requested).toEqual([{ profile: PROFILE, body: { path: `${CWD}/logs`, sessionId: SESSION } }]);
    const panel = await screen.findByRole('region', { name: 'Folder archives' });
    expect(within(panel).getByText('logs')).toBeInTheDocument();
    expect(within(panel).getByText('Building the archive on the server…')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Download archive/ })).not.toBeInTheDocument();

    // The poll (every 2 s) answers running, then ready.
    const button = await within(panel).findByRole('button', { name: 'Download archive of logs' }, { timeout: 8000 });
    expect(within(panel).getByText(/5\.0 MB|5 MB/)).toBeInTheDocument();
    expect(within(panel).queryByText('Building the archive on the server…')).not.toBeInTheDocument();

    await user.click(button);
    await waitFor(() => expect(downloads).toEqual([ARCHIVE]));
    await waitFor(() => expect(anchorClicks).toEqual([{ href: 'https://storage.example.test/a.tar.gz?sig=1', download: 'projects.tar.gz' }]));
  }, 20000);

  it('shows the failure reason and lets the person dismiss it', async () => {
    const user = userEvent.setup();
    polls = [view({ status: 'failed', errorCode: 'ARCHIVE_TOO_LARGE', errorMessage: 'The archive is larger than the download limit.' })];
    await renderBrowser();
    const menu = await openFolderMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Download as archive' }));

    const panel = await screen.findByRole('region', { name: 'Folder archives' });
    expect(await within(panel).findByText('The archive is larger than the download limit.', {}, { timeout: 6000 })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Download archive/ })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Dismiss archive of projects' }));
    expect(screen.queryByTestId('archive-panel')).not.toBeInTheDocument();
  }, 20000);

  it('shows a warning on a ready archive (tar exit 1)', async () => {
    const user = userEvent.setup();
    polls = [view({ status: 'ready', sizeBytes: 2048, warning: 'Some files changed while they were being read; the archive may be inconsistent.' })];
    await renderBrowser();
    const menu = await openFolderMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Download as archive' }));
    expect(await screen.findByText(/Some files changed while they were being read/, {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download archive of projects' })).toBeInTheDocument();
  }, 20000);

  it('shows why the request was refused', async () => {
    const user = userEvent.setup();
    startFails = { status: 429, code: 'FILES_RATE_LIMITED', message: 'Too many folder archives are being built; wait for one to finish' };
    await renderBrowser();
    const menu = await openFolderMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Download as archive' }));
    const panel = await screen.findByRole('region', { name: 'Folder archives' });
    expect(await within(panel).findByText(/Too many folder archives are being built/)).toBeInTheDocument();
  });

  it('reports a failed download link as a notice', async () => {
    const user = userEvent.setup();
    polls = [view({ status: 'ready', sizeBytes: 10 })];
    server.use(http.get('*/api/files/archives/:id/download', () => HttpResponse.json({ code: 'FILE_ARCHIVE_NOT_READY', message: 'The archive is not ready to download' }, { status: 409 })));
    await renderBrowser();
    const menu = await openFolderMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Download as archive' }));
    await user.click(await screen.findByRole('button', { name: 'Download archive of projects' }, { timeout: 6000 }));
    expect(await screen.findByText(/Could not download: The archive is not ready to download/)).toBeInTheDocument();
    expect(anchorClicks).toEqual([]);
  }, 20000);
});
