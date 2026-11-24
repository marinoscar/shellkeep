import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../mocks/server';
import { render } from '../../../utils/test-utils';
import { CWD, HOME, PROFILE, SESSION, fakeFilesHandlers, type ListRequest } from './fakeFiles';

const { openFile } = vi.hoisted(() => ({ openFile: vi.fn() }));
vi.mock('../../../../components/files/viewer/FileViewerProvider', () => ({
  useOpenFile: () => ({ openFile, closeFile: vi.fn() }),
}));

import { FileBrowser, FOLLOW_FOCUS_REFRESH_MS } from '../../../../components/files/browser/FileBrowser';

let state: { cwd: string; requests: ListRequest[]; failProfile?: { status: number; code: string } };

beforeEach(() => {
  openFile.mockReset();
  state = { cwd: CWD, requests: [] };
  server.use(...fakeFilesHandlers(state));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const list = () => screen.getByRole('list', { name: /^Files in / });
const rowNames = () =>
  within(list())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('button')!.getAttribute('aria-label')!.split(',')[0]);
const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}, `) });

async function renderHome(props: Partial<Parameters<typeof FileBrowser>[0]> = {}) {
  const result = render(<FileBrowser profileId={PROFILE} {...props} />);
  await screen.findByRole('list', { name: props.sessionId ? `Files in ${CWD}` : `Files in ${HOME}` });
  return result;
}

describe('FileBrowser listing (#156)', () => {
  it('lists home without a session: folders first, dotfiles hidden, sizes and badges', async () => {
    await renderHome();
    expect(state.requests[0]).toEqual({ path: '~', sessionId: null });
    expect(rowNames()).toEqual(['projects', 'big.log', 'huge.bin', 'notes.txt']);
    expect(screen.getByRole('textbox', { name: 'Path' })).toHaveValue(HOME);
    expect(row('notes.txt')).toHaveAccessibleName(/notes\.txt, file, 1\.2 KB, modified/);
    expect(within(row('big.log')).getByText('Large')).toBeInTheDocument();
    expect(within(row('huge.bin')).getByText('Download only')).toBeInTheDocument();
    expect(within(row('notes.txt')).queryByText(/Large|Download only/)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('sorts by size and by modified, both directions, folders kept first', async () => {
    const user = userEvent.setup();
    await renderHome();
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(screen.getByRole('option', { name: 'Size' }));
    expect(rowNames()).toEqual(['projects', 'notes.txt', 'big.log', 'huge.bin']);
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(rowNames()).toEqual(['projects', 'huge.bin', 'big.log', 'notes.txt']);
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(screen.getByRole('option', { name: 'Modified' }));
    expect(rowNames()).toEqual(['projects', 'big.log', 'huge.bin', 'notes.txt']);
  });

  it('shows hidden files on demand and filters by name', async () => {
    const user = userEvent.setup();
    await renderHome();
    const toggle = screen.getByRole('button', { name: 'Show hidden files' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['.config', 'projects', '.bashrc', 'big.log', 'huge.bin', 'notes.txt']);

    await user.type(screen.getByRole('textbox', { name: 'Filter files' }), 'LOG');
    expect(rowNames()).toEqual(['big.log']);
    await user.clear(screen.getByRole('textbox', { name: 'Filter files' }));
    await user.type(screen.getByRole('textbox', { name: 'Filter files' }), 'nothing');
    expect(screen.getByText('No files match the filter.')).toBeInTheDocument();
  });
});

describe('FileBrowser navigation (#156)', () => {
  it('opens a folder, goes up landing on it, and follows breadcrumbs', async () => {
    const user = userEvent.setup();
    await renderHome();
    await user.click(row('projects'));
    await screen.findByRole('list', { name: `Files in ${HOME}/projects` });
    expect(rowNames()).toEqual(['app.ts']);

    await user.click(screen.getByRole('button', { name: 'Up one folder' }));
    await screen.findByRole('list', { name: `Files in ${HOME}` });
    await waitFor(() => expect(row('projects')).toHaveAttribute('aria-current', 'true'));

    const crumbs = screen.getByRole('navigation', { name: 'Current folder' });
    await user.click(within(crumbs).getByRole('button', { name: 'home' }));
    await screen.findByRole('list', { name: 'Files in /home' });
    expect(within(screen.getByRole('navigation', { name: 'Current folder' })).getByText('home')).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('goes to a typed path on Enter, relative to the current folder', async () => {
    const user = userEvent.setup();
    await renderHome();
    const field = screen.getByRole('textbox', { name: 'Path' });
    await user.clear(field);
    await user.type(field, 'projects{Enter}');
    await screen.findByRole('list', { name: `Files in ${HOME}/projects` });
    expect(state.requests.at(-1)!.path).toBe(`${HOME}/projects`);

    await user.clear(field);
    await user.type(field, '/srv{Enter}');
    await screen.findByRole('list', { name: 'Files in /srv' });
  });

  it('navigates with the keyboard: arrows, Enter, Backspace', async () => {
    const user = userEvent.setup();
    await renderHome();
    row('projects').focus();
    await user.keyboard('{ArrowDown}');
    expect(row('big.log')).toHaveFocus();
    await user.keyboard('{End}');
    expect(row('notes.txt')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(row('projects')).toHaveFocus();
    expect(row('projects')).toHaveAttribute('tabindex', '0');
    expect(row('big.log')).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{Enter}');
    await screen.findByRole('list', { name: `Files in ${HOME}/projects` });
    within(list()).getAllByRole('button')[0]!.focus();
    await user.keyboard('{Backspace}');
    await screen.findByRole('list', { name: `Files in ${HOME}` });
  });

  it('opens the row menu from the keyboard (Shift+F10)', async () => {
    const user = userEvent.setup();
    await renderHome();
    row('notes.txt').focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const menu = await screen.findByRole('menu', { name: 'Actions for notes.txt' });
    expect(within(menu).getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
  });
});

describe('FileBrowser actions (#156)', () => {
  it('opens a file in the viewer with the session', async () => {
    const user = userEvent.setup();
    await renderHome({ sessionId: SESSION });
    await user.click(row('server.log'));
    expect(openFile).toHaveBeenCalledWith({ profileId: PROFILE, path: `${CWD}/server.log`, sessionId: SESSION });
  });

  it('opens a file without a session from the server page', async () => {
    const user = userEvent.setup();
    await renderHome();
    await user.click(screen.getByRole('button', { name: 'More actions for notes.txt' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(openFile).toHaveBeenCalledWith({ profileId: PROFILE, path: `${HOME}/notes.txt` });
  });

  it('downloads through a token and the native download', async () => {
    const tokens: unknown[] = [];
    server.use(
      http.post('*/api/server-profiles/:id/files/download-token', async ({ request }) => {
        tokens.push(await request.json());
        return HttpResponse.json({ data: { token: 'tok-1', expiresAt: '2026-11-24T00:01:00.000Z' } });
      }),
    );
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    const user = userEvent.setup();
    await renderHome();
    await user.click(screen.getByRole('button', { name: 'More actions for huge.bin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download' }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(tokens).toEqual([{ path: `${HOME}/huge.bin` }]);
    expect(clicked[0]).toMatch(/\/api\/files\/download\/tok-1$/);
  });

  it('reports a failed download', async () => {
    server.use(
      http.post('*/api/server-profiles/:id/files/download-token', () =>
        HttpResponse.json({ code: 'FILES_RATE_LIMITED', message: 'Too many downloads' }, { status: 429 }),
      ),
    );
    const user = userEvent.setup();
    await renderHome();
    await user.click(screen.getByRole('button', { name: 'More actions for notes.txt' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download' }));
    expect(await screen.findByText('Could not download: Too many downloads')).toBeInTheDocument();
  });

  it('copies the absolute path; a folder offers no download', async () => {
    const user = userEvent.setup();
    // After setup: user-event installs its own clipboard stub.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderHome();
    await user.click(screen.getByRole('button', { name: 'More actions for projects' }));
    const menu = screen.getByRole('menu', { name: 'Actions for projects' });
    expect(within(menu).queryByRole('menuitem', { name: 'Download' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /archive/i })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith(`${HOME}/projects`);
    expect(await screen.findByText('Path copied')).toBeInTheDocument();
  });
});

describe('FileBrowser follow terminal directory (#156)', () => {
  it('lists the session directory and refreshes on window focus', async () => {
    await renderHome({ sessionId: SESSION });
    expect(state.requests[0]).toEqual({ path: '.', sessionId: SESSION });
    expect(screen.getByRole('switch', { name: 'Follow terminal directory' })).toBeChecked();
    expect(rowNames()).toEqual(['logs', 'server.log']);

    // The shell moved; a focus after the throttle lists the new directory.
    state.cwd = `${CWD}/logs`;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + FOLLOW_FOCUS_REFRESH_MS + 1);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByRole('list', { name: `Files in ${CWD}/logs` });
    expect(state.requests.at(-1)).toEqual({ path: '.', sessionId: SESSION });
  });

  it('refreshes on demand and stops following once the user navigates', async () => {
    const user = userEvent.setup();
    await renderHome({ sessionId: SESSION });
    state.cwd = `${CWD}/logs`;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('list', { name: `Files in ${CWD}/logs` });

    await user.click(within(screen.getByRole('navigation', { name: 'Current folder' })).getByRole('button', { name: 'srv' }));
    await screen.findByRole('list', { name: 'Files in /srv' });
    expect(screen.getByRole('switch', { name: 'Follow terminal directory' })).not.toBeChecked();

    await user.click(screen.getByRole('switch', { name: 'Follow terminal directory' }));
    await screen.findByRole('list', { name: `Files in ${CWD}/logs` });
  });

  it('starts at a revealed folder with the entry selected', async () => {
    render(<FileBrowser profileId={PROFILE} sessionId={SESSION} reveal={{ dir: `${CWD}/logs`, select: 'error.log', seq: 1 }} />);
    await screen.findByRole('list', { name: `Files in ${CWD}/logs` });
    await waitFor(() => expect(row('error.log')).toHaveAttribute('aria-current', 'true'));
    expect(screen.getByRole('switch', { name: 'Follow terminal directory' })).not.toBeChecked();
  });
});

describe('FileBrowser errors (#156)', () => {
  it('explains SFTP being unavailable', async () => {
    state.failProfile = { status: 502, code: 'SFTP_UNAVAILABLE' };
    render(<FileBrowser profileId={PROFILE} />);
    expect(await screen.findByTestId('file-browser-error')).toHaveTextContent(
      'This server does not offer SFTP, so its files cannot be browsed.',
    );
  });

  it('explains permission denied and not found, and recovers', async () => {
    const user = userEvent.setup();
    await renderHome();
    const field = screen.getByRole('textbox', { name: 'Path' });
    await user.clear(field);
    await user.type(field, '/root{Enter}');
    expect(await screen.findByTestId('file-browser-error')).toHaveTextContent(
      'Permission denied: the server user may not read this folder.',
    );
    await user.clear(field);
    await user.type(field, '/missing{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('file-browser-error')).toHaveTextContent('This folder does not exist on the server.'),
    );
    await user.clear(field);
    fireEvent.change(field, { target: { value: '/srv' } });
    await user.type(field, '{Enter}');
    await screen.findByRole('list', { name: 'Files in /srv' });
    expect(screen.queryByTestId('file-browser-error')).not.toBeInTheDocument();
  });
});
