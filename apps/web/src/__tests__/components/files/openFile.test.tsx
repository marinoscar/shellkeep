import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import {
  FileViewerProvider,
  fileViewerPath,
  parseFileViewerSearch,
  useOpenFile,
  type OpenFileTarget,
} from '../../../components/files/viewer/FileViewerProvider';
import FileViewerPage from '../../../pages/FileViewerPage';
import { resolveActiveDestination } from '../../../config/destinations';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

let statPaths: string[];
let statSessions: (string | null)[];

beforeEach(() => {
  statPaths = [];
  statSessions = [];
  server.use(
    http.get('*/api/server-profiles/:id/files/stat', ({ request }) => {
      const params = new URL(request.url).searchParams;
      statPaths.push(params.get('path')!);
      statSessions.push(params.get('sessionId'));
      return HttpResponse.json({
        data: {
          name: 'app.conf',
          path: '/etc/app/app.conf',
          type: 'file',
          size: 12,
          mtime: null,
          mode: '0644',
          mime: 'text/plain',
          isText: true,
        },
      });
    }),
    http.get('*/api/server-profiles/:id/files/content', () =>
      HttpResponse.json({ data: { text: 'key = value\n', offset: 0, length: 12, size: 12, eof: true } }),
    ),
  );
});

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function Opener({ target }: { target: OpenFileTarget }) {
  const { openFile } = useOpenFile();
  return (
    <button type="button" onClick={() => openFile(target)}>
      open
    </button>
  );
}

describe('fileViewerPath (#154)', () => {
  it('builds the deep link and reads it back', () => {
    const target = { profileId: PROFILE, path: './logs/app.log', sessionId: SESSION, line: 42 };
    const link = fileViewerPath(target);
    expect(link).toBe(`/servers/${PROFILE}/files/view?path=.%2Flogs%2Fapp.log&sessionId=${SESSION}&line=42`);
    const search = new URLSearchParams(link.slice(link.indexOf('?')));
    expect(parseFileViewerSearch(PROFILE, search)).toEqual(target);
  });

  it('ignores a bad line and refuses a missing path', () => {
    expect(parseFileViewerSearch(PROFILE, new URLSearchParams('path=/a&line=zero'))).toEqual({
      profileId: PROFILE,
      path: '/a',
      sessionId: undefined,
      line: undefined,
    });
    expect(parseFileViewerSearch(PROFILE, new URLSearchParams(''))).toBeNull();
  });

  it('is owned by the servers destination', () => {
    expect(resolveActiveDestination(fileViewerPath({ profileId: PROFILE, path: '/a' }).split('?')[0]!)).toBe('servers');
  });
});

describe('openFile (#154)', () => {
  it('opens the viewer in a dialog over the page and closes it', async () => {
    const user = userEvent.setup();
    render(
      <FileViewerProvider>
        <Opener target={{ profileId: PROFILE, path: 'app.conf', sessionId: SESSION }} />
        <Location />
      </FileViewerProvider>,
      { wrapperOptions: { route: '/sessions/abc' } },
    );

    await user.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog', { name: 'File app.conf' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(statPaths).toEqual(['app.conf']));
    expect(statSessions).toEqual([SESSION]);
    expect(screen.getByTestId('location')).toHaveTextContent('/sessions/abc');
    expect(await screen.findByText('/etc/app/app.conf')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close file' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('navigates to the viewer page when no provider is mounted', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Opener target={{ profileId: PROFILE, path: '/etc/hosts', line: 3 }} />
        <Location />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/servers/${PROFILE}/files/view?path=%2Fetc%2Fhosts&line=3`);
  });
});

describe('FileViewerPage (#154)', () => {
  it('opens the file named by the deep link', async () => {
    render(
      <Routes>
        <Route path="/servers/:id/files/view" element={<FileViewerPage />} />
      </Routes>,
      { wrapperOptions: { route: fileViewerPath({ profileId: PROFILE, path: '/etc/app/app.conf' }) } },
    );
    expect(await screen.findByRole('heading', { name: 'app.conf' })).toBeInTheDocument();
    await waitFor(() => expect(statPaths).toEqual(['/etc/app/app.conf']));
  });

  it('explains a link without a path', async () => {
    render(
      <Routes>
        <Route path="/servers/:id/files/view" element={<FileViewerPage />} />
      </Routes>,
      { wrapperOptions: { route: `/servers/${PROFILE}/files/view` } },
    );
    expect(await screen.findByText(/No file was given/)).toBeInTheDocument();
  });
});
