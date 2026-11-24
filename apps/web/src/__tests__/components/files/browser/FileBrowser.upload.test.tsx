import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../mocks/server';
import { render, mockUser } from '../../../utils/test-utils';
import { HOME, PROFILE, SESSION, CWD, fakeFilesHandlers, type ListRequest } from './fakeFiles';

vi.mock('../../../../components/files/viewer/FileViewerProvider', () => ({
  useOpenFile: () => ({ openFile: vi.fn(), closeFile: vi.fn() }),
}));

import { FileBrowser } from '../../../../components/files/browser/FileBrowser';
import { UPLOAD_CONCURRENCY } from '../../../../components/files/browser/useFileUploads';

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:write'] };
const MB = 1024 * 1024;

interface UploadSeen {
  path: string | null;
  name: string | null;
  overwrite: string | null;
  sessionId: string | null;
  contentType: string | null;
  bytes: number;
}

let state: { cwd: string; requests: ListRequest[] };
let uploads: UploadSeen[];
let inFlight: number;
let maxInFlight: number;
/** Names that exist on the "server": an upload without overwrite answers 409. */
let existing: Set<string>;
/** When set, an upload waits for it before answering (to look at progress and to cancel). */
let gate: Promise<void> | null;
let failWith: { status: number; code: string; message: string } | null;

beforeEach(() => {
  state = { cwd: CWD, requests: [] };
  uploads = [];
  inFlight = 0;
  maxInFlight = 0;
  existing = new Set();
  gate = null;
  failWith = null;
  server.use(
    ...fakeFilesHandlers(state),
    http.post('*/api/server-profiles/:id/files/upload', async ({ request }) => {
      const url = new URL(request.url);
      const name = url.searchParams.get('name');
      const overwrite = url.searchParams.get('overwrite');
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const bytes = (await request.arrayBuffer()).byteLength;
        uploads.push({
          path: url.searchParams.get('path'),
          name,
          overwrite,
          sessionId: url.searchParams.get('sessionId'),
          contentType: request.headers.get('content-type'),
          bytes,
        });
        if (gate) await gate;
        if (failWith) return HttpResponse.json(failWith, { status: failWith.status });
        if (existing.has(name ?? '') && overwrite !== 'true') {
          return HttpResponse.json(
            { code: 'FILE_EXISTS', message: 'A file with that name already exists', details: { name, size: 12, mtime: '2026-11-20T00:00:00.000Z' } },
            { status: 409 },
          );
        }
        return HttpResponse.json({ data: { path: `${url.searchParams.get('path')}/${name}`, name, size: bytes, overwritten: overwrite === 'true' } }, { status: 201 });
      } finally {
        inFlight -= 1;
      }
    }),
  );
});

const file = (name: string, content = 'hello world') => new File([content], name, { type: 'text/plain' });

async function renderBrowser(props: Partial<Parameters<typeof FileBrowser>[0]> = {}, user = writer) {
  const result = render(<FileBrowser profileId={PROFILE} {...props} />, { wrapperOptions: { user } });
  await screen.findByRole('list', { name: props.sessionId ? `Files in ${CWD}` : `Files in ${HOME}` });
  return result;
}

const chooser = () => screen.getByTestId('upload-input') as HTMLInputElement;
const panel = () => screen.getByRole('region', { name: 'Uploads' });
const dropOn = (target: Element, files: File[]) =>
  fireEvent.drop(target, { dataTransfer: { types: ['Files'], files, items: [] } });

describe('FileBrowser upload (#157)', () => {
  it('offers no upload without sessions:write', async () => {
    await renderBrowser({}, mockUser);
    expect(screen.queryByRole('button', { name: 'Upload files' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('upload-input')).not.toBeInTheDocument();
    dropOn(screen.getByTestId('file-browser'), [file('a.txt')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(uploads).toEqual([]);
  });

  it('uploads a picked file into the listed folder as raw octet-stream, then refreshes the listing', async () => {
    const user = userEvent.setup();
    await renderBrowser();
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled();
    const before = state.requests.length;
    await user.upload(chooser(), file('report.txt', 'twelve bytes'));

    await waitFor(() => expect(within(panel()).getByText('Uploaded')).toBeInTheDocument());
    expect(uploads).toEqual([
      { path: HOME, name: 'report.txt', overwrite: 'false', sessionId: null, contentType: 'application/octet-stream', bytes: 12 },
    ]);
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    expect(screen.getByRole('status')).toHaveTextContent('Uploaded report.txt');
  });

  it('uploads into the session\'s folder and passes the session', async () => {
    const user = userEvent.setup();
    await renderBrowser({ sessionId: SESSION });
    await user.upload(chooser(), file('x.txt'));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ path: CWD, sessionId: SESSION });
  });

  it('accepts several files at once from the picker', async () => {
    const user = userEvent.setup();
    await renderBrowser();
    expect(chooser()).toHaveAttribute('multiple');
    await user.upload(chooser(), [file('a.txt'), file('b.txt'), file('c.txt')]);
    await waitFor(() => expect(within(panel()).getAllByText('Uploaded')).toHaveLength(3));
    expect(uploads.map((u) => u.name).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('announces the drop zone while files are dragged over, and uploads what is dropped', async () => {
    await renderBrowser();
    const root = screen.getByTestId('file-browser');
    expect(screen.getByRole('list', { name: `Files in ${HOME}` })).toHaveAccessibleDescription('Drop files here to upload them to this folder.');
    fireEvent.dragEnter(root, { dataTransfer: { types: ['Files'] } });
    expect(await screen.findByTestId('upload-drop-zone')).toHaveTextContent(`Drop files to upload to ${HOME}`);
    dropOn(root, [file('dropped.txt')]);
    expect(screen.queryByTestId('upload-drop-zone')).not.toBeInTheDocument();
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ name: 'dropped.txt', path: HOME });
  });

  it('ignores a drag that carries no files (text, a link)', async () => {
    await renderBrowser();
    fireEvent.dragEnter(screen.getByTestId('file-browser'), { dataTransfer: { types: ['text/plain'] } });
    expect(screen.queryByTestId('upload-drop-zone')).not.toBeInTheDocument();
  });

  it('shows per-file progress and sends at most two at a time', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    await renderBrowser();
    await user.upload(chooser(), [file('a.txt'), file('b.txt'), file('c.txt')]);

    await waitFor(() => expect(uploads).toHaveLength(UPLOAD_CONCURRENCY));
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.getByRole('progressbar', { name: 'Uploading a.txt' })).toBeInTheDocument();
    expect(within(panel()).getByText('Waiting')).toBeInTheDocument();
    expect(maxInFlight).toBe(UPLOAD_CONCURRENCY);

    await act(async () => release());
    await waitFor(() => expect(within(panel()).getAllByText('Uploaded')).toHaveLength(3));
    expect(maxInFlight).toBe(UPLOAD_CONCURRENCY);
    expect(uploads).toHaveLength(3);
  });

  it('cancels a running upload and one that has not started', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    await renderBrowser();
    await user.upload(chooser(), [file('a.txt'), file('b.txt'), file('c.txt')]);
    await waitFor(() => expect(uploads).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Cancel upload of c.txt' }));
    await user.click(screen.getByRole('button', { name: 'Cancel upload of a.txt' }));
    await waitFor(() => expect(within(panel()).getAllByText('Cancelled')).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent(/Cancelled the upload of/);

    await act(async () => release());
    await waitFor(() => expect(within(panel()).getByText('Uploaded')).toBeInTheDocument());
    // c.txt never started; a.txt was aborted; only b.txt completed.
    expect(uploads.map((u) => u.name)).not.toContain('c.txt');
    expect(screen.queryByRole('button', { name: /Cancel upload/ })).not.toBeInTheDocument();
  });

  it('refuses a file over the cap before sending anything', async () => {
    const user = userEvent.setup();
    await renderBrowser();
    const huge = file('huge.iso');
    Object.defineProperty(huge, 'size', { value: 101 * MB });
    await user.upload(chooser(), huge);
    expect(await within(panel()).findByText('huge.iso is larger than the upload limit of 100 MB')).toBeInTheDocument();
    expect(within(panel()).getByText('Failed')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('huge.iso is larger than the upload limit of 100 MB');
    await new Promise((r) => setTimeout(r, 30));
    expect(uploads).toEqual([]);
  });

  it('accepts a file exactly at the cap', async () => {
    const user = userEvent.setup();
    await renderBrowser();
    const edge = file('edge.bin');
    Object.defineProperty(edge, 'size', { value: 100 * MB });
    // The size is faked, so only the decision is under test: it is queued, not refused.
    await user.upload(chooser(), edge);
    await waitFor(() => expect(within(panel()).queryByText(/larger than the upload limit/)).not.toBeInTheDocument());
  });

  it('shows the API\'s own refusal (413 from the server\'s setting)', async () => {
    const user = userEvent.setup();
    failWith = { status: 413, code: 'FILE_TOO_LARGE', message: 'The file is larger than the upload limit' };
    await renderBrowser();
    await user.upload(chooser(), file('a.txt'));
    expect(await within(panel()).findByText("The file is larger than the server's upload limit")).toBeInTheDocument();
  });

  describe('a file that already exists (409)', () => {
    it('asks, and Replace sends it again with overwrite=true', async () => {
      const user = userEvent.setup();
      existing.add('notes.txt');
      await renderBrowser();
      await user.upload(chooser(), file('notes.txt', 'new content'));

      const dialog = await screen.findByRole('dialog', { name: 'Replace existing file?' });
      expect(dialog).toHaveTextContent(`"notes.txt" already exists in ${HOME}`);
      expect(dialog).toHaveTextContent('12 B');
      await user.click(within(dialog).getByRole('button', { name: 'Replace' }));

      await waitFor(() => expect(within(panel()).getByText('Uploaded')).toBeInTheDocument());
      expect(uploads.map((u) => u.overwrite)).toEqual(['false', 'true']);
      expect(uploads[1].bytes).toBe(11);
    });

    it('Skip leaves the file alone and sends nothing more', async () => {
      const user = userEvent.setup();
      existing.add('notes.txt');
      await renderBrowser();
      await user.upload(chooser(), file('notes.txt'));
      await user.click(await screen.findByRole('button', { name: 'Skip' }));
      await waitFor(() => expect(within(panel()).getByText('Skipped')).toBeInTheDocument());
      expect(uploads).toHaveLength(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('"Apply to all" answers the remaining conflicts without asking again', async () => {
      const user = userEvent.setup();
      existing.add('a.txt');
      existing.add('b.txt');
      await renderBrowser();
      await user.upload(chooser(), [file('a.txt'), file('b.txt')]);
      const dialog = await screen.findByRole('dialog', { name: 'Replace existing file?' });
      await user.click(within(dialog).getByRole('checkbox', { name: 'Apply to all' }));
      await user.click(within(dialog).getByRole('button', { name: 'Replace' }));

      await waitFor(() => expect(within(panel()).getAllByText('Uploaded')).toHaveLength(2));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(uploads.filter((u) => u.overwrite === 'true').map((u) => u.name).sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('asks again for each conflict without "Apply to all"', async () => {
      const user = userEvent.setup();
      existing.add('a.txt');
      existing.add('b.txt');
      await renderBrowser();
      await user.upload(chooser(), [file('a.txt'), file('b.txt')]);
      await user.click(await screen.findByRole('button', { name: 'Skip' }));
      await user.click(await screen.findByRole('button', { name: 'Replace' }));
      await waitFor(() => expect(within(panel()).getByText('Uploaded')).toBeInTheDocument());
      expect(within(panel()).getByText('Skipped')).toBeInTheDocument();
    });
  });

  it('clears finished uploads from the panel', async () => {
    const user = userEvent.setup();
    await renderBrowser();
    await user.upload(chooser(), file('a.txt'));
    await waitFor(() => expect(within(panel()).getByText('Uploaded')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(screen.queryByRole('region', { name: 'Uploads' })).not.toBeInTheDocument();
  });
});
