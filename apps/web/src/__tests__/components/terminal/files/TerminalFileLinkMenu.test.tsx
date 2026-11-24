import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';

const { openFile, downloadRemoteFile } = vi.hoisted(() => ({
  openFile: vi.fn(),
  downloadRemoteFile: vi.fn(),
}));

vi.mock('../../../../components/files/viewer/FileViewerProvider', () => ({
  useOpenFile: () => ({ openFile, closeFile: vi.fn() }),
}));
vi.mock('../../../../services/files-api', () => ({ downloadRemoteFile }));

import { TerminalFileLinkMenu } from '../../../../components/terminal/files/TerminalFileLinkMenu';
import type { FileLinkMenuState } from '../../../../components/terminal/files/useTerminalFileLinks';
import type { FileStatLike } from '../../../../lib/terminal/file-stat-cache';

function menuState(path: string, stat: FileStatLike, line?: number): FileLinkMenuState {
  return {
    anchor: { x: 20, y: 30 },
    link: {
      reference: { path, ...(line ? { line } : {}), start: 0, end: path.length },
      stat,
      text: path,
      range: { start: { x: 1, y: 1 }, end: { x: path.length, y: 1 } },
    },
  };
}

const FILE = menuState('src/app.ts', { path: '/srv/repo/src/app.ts', type: 'file', isText: true }, 42);
const DIR = menuState('logs/', { path: '/srv/repo/logs', type: 'dir' });

describe('TerminalFileLinkMenu (#155)', () => {
  const onClose = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    downloadRemoteFile.mockResolvedValue(undefined);
  });

  function renderMenu(state: FileLinkMenuState | null, onShowInFileBrowser?: () => void) {
    return render(
      <TerminalFileLinkMenu
        sessionId="sess-1"
        profileId="prof-1"
        state={state}
        onClose={onClose}
        onShowInFileBrowser={onShowInFileBrowser}
      />,
    );
  }

  it('shows nothing while closed', () => {
    renderMenu(null);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the resolved path at the printed line', async () => {
    renderMenu(FILE);
    expect(screen.getByText('/srv/repo/src/app.ts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open at line 42' }));
    expect(openFile).toHaveBeenCalledWith({ profileId: 'prof-1', path: '/srv/repo/src/app.ts', sessionId: 'sess-1', line: 42 });
    expect(onClose).toHaveBeenCalled();
  });

  it('downloads through a token', async () => {
    renderMenu(FILE);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
    expect(downloadRemoteFile).toHaveBeenCalledWith({ profileId: 'prof-1', path: '/srv/repo/src/app.ts', sessionId: 'sess-1' });
  });

  it('reports a failed download', async () => {
    downloadRemoteFile.mockRejectedValueOnce(new Error('Too many downloads'));
    renderMenu(FILE);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
    expect(await screen.findByText('Could not download: Too many downloads')).toBeInTheDocument();
  });

  it('copies the resolved absolute path', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderMenu(FILE);
    await user.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith('/srv/repo/src/app.ts');
    expect(await screen.findByText('Path copied')).toBeInTheDocument();
  });

  it('copies the path as printed when the API resolved none', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderMenu(menuState('./x.log', { path: '', type: 'file' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith('./x.log');
  });

  it('hides Show in file browser until a callback is given', async () => {
    renderMenu(FILE);
    expect(screen.queryByRole('menuitem', { name: 'Show in file browser' })).not.toBeInTheDocument();
  });

  it('calls the file browser callback with the path and type', async () => {
    const show = vi.fn();
    renderMenu(FILE, show);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show in file browser' }));
    expect(show).toHaveBeenCalledWith({ profileId: 'prof-1', path: '/srv/repo/src/app.ts', type: 'file' });
  });

  it('offers only Copy path for a directory without a file browser', () => {
    renderMenu(DIR);
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Copy path']);
  });

  it('offers Show in file browser and Copy path for a directory with one', () => {
    renderMenu(DIR, vi.fn());
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Show in file browser', 'Copy path']);
  });

  it('still opens a binary file (the viewer shows its card)', async () => {
    renderMenu(menuState('/bin/tool', { path: '/bin/tool', type: 'file', isText: false }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => expect(openFile).toHaveBeenCalledWith({ profileId: 'prof-1', path: '/bin/tool', sessionId: 'sess-1' }));
  });
});
