import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { EditorView } from '@uiw/react-codemirror';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { FileViewer } from '../../../components/files/viewer/FileViewer';
import { FOLLOW_INTERVAL_MS } from '../../../components/files/viewer/useFileDocument';
import { ENV_MASK } from '../../../lib/files/viewer/text';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const BASE = `*/api/server-profiles/${PROFILE}/files`;

interface FakeFile {
  content?: string;
  size?: number;
  isText?: boolean;
  mime?: string;
  /** Window size the fake API serves (the full-view cap). */
  window?: number;
  /** Answer content reads with this error. */
  contentError?: { status: number; code: string };
}

// jsdom has no layout: CodeMirror measures text ranges.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

let files: Record<string, FakeFile>;
let contentRequests: URLSearchParams[];
let statRequests: number;
let tokenBodies: unknown[];

function sizeOf(file: FakeFile): number {
  return file.size ?? new TextEncoder().encode(file.content ?? '').length;
}

beforeEach(() => {
  files = {};
  contentRequests = [];
  statRequests = 0;
  tokenBodies = [];
  server.use(
    http.get(`${BASE}/stat`, ({ request }) => {
      statRequests += 1;
      const path = new URL(request.url).searchParams.get('path')!;
      const file = files[path];
      if (!file) return HttpResponse.json({ code: 'FILE_NOT_FOUND', message: 'nope' }, { status: 404 });
      return HttpResponse.json({
        data: {
          name: path.slice(path.lastIndexOf('/') + 1),
          path,
          type: 'file',
          size: sizeOf(file),
          mtime: '2026-11-24T00:00:00.000Z',
          mode: '0644',
          mime: file.mime ?? 'text/plain',
          isText: file.isText ?? true,
        },
      });
    }),
    http.get(`${BASE}/content`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      contentRequests.push(params);
      const file = files[params.get('path')!]!;
      if (file.contentError) {
        return HttpResponse.json({ code: file.contentError.code, message: 'refused' }, { status: file.contentError.status });
      }
      const size = sizeOf(file);
      const offset = Number(params.get('offset') ?? 0);
      const length = Math.min(file.window ?? 2 * 1024 * 1024, size - offset);
      const text = file.content !== undefined ? file.content.slice(offset, offset + length) : 'x'.repeat(length);
      return HttpResponse.json({ data: { text, offset, length, size, eof: offset + length >= size } });
    }),
    http.post(`${BASE}/download-token`, async ({ request }) => {
      tokenBodies.push(await request.json());
      return HttpResponse.json({ data: { token: `tok-${tokenBodies.length}`, expiresAt: '2026-11-24T00:01:00.000Z' } });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderViewer(path: string, extra: { line?: number; sessionId?: string } = {}) {
  return render(<FileViewer profileId={PROFILE} path={path} {...extra} />);
}

async function editorView(): Promise<EditorView> {
  let view: EditorView | null = null;
  await waitFor(() => {
    const dom = document.querySelector('.cm-editor');
    expect(dom).not.toBeNull();
    view = EditorView.findFromDOM(dom as HTMLElement);
    expect(view).not.toBeNull();
  });
  return view!;
}

async function editorText(): Promise<string> {
  return (await editorView()).state.doc.toString();
}

describe('FileViewer guardrail states (#154)', () => {
  it('shows a small text file in full', async () => {
    files['/etc/app/settings.ini'] = { content: '[main]\nname = demo\n' };
    renderViewer('/etc/app/settings.ini');

    await waitFor(async () => expect(await editorText()).toBe('[main]\nname = demo\n'));
    expect(screen.getByText('INI / config')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'File windows' })).not.toBeInTheDocument();
    expect(contentRequests).toHaveLength(1);
    expect(contentRequests[0]!.get('offset')).toBe('0');
    expect(contentRequests[0]!.has('length')).toBe(false);
  });

  it('pages a file larger than one window and navigates between windows', async () => {
    const content = Array.from({ length: 30 }, (_, i) => `line ${String(i).padStart(2, '0')}`).join('\n');
    files['/srv/data/big.txt'] = { content, window: 100 };
    const user = userEvent.setup();
    renderViewer('/srv/data/big.txt');

    const nav = await screen.findByRole('navigation', { name: 'File windows' });
    expect(screen.getByText('Paged')).toBeInTheDocument();
    await waitFor(async () => expect(await editorText()).toBe(content.slice(0, 100)));
    expect(within(nav).getByRole('button', { name: 'First window' })).toBeDisabled();

    await user.click(within(nav).getByRole('button', { name: 'Next window' }));
    await waitFor(async () => expect(await editorText()).toBe(content.slice(100, 200)));
    expect(contentRequests.at(-1)!.get('offset')).toBe('100');

    await user.click(within(nav).getByRole('button', { name: 'Previous window' }));
    await waitFor(() => expect(contentRequests.at(-1)!.get('offset')).toBe('0'));

    await user.click(within(nav).getByRole('button', { name: 'Last window' }));
    await waitFor(() => expect(contentRequests.at(-1)!.get('offset')).toBe(String(content.length - 100)));
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Next window' })).toBeDisabled());

    await user.type(within(nav).getByLabelText('Jump to offset or %'), '50%');
    await user.click(within(nav).getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(contentRequests.at(-1)!.get('offset')).toBe(String(Math.floor(content.length / 2))));

    await user.clear(within(nav).getByLabelText('Jump to offset or %'));
    await user.type(within(nav).getByLabelText('Jump to offset or %'), 'nonsense');
    await user.click(within(nav).getByRole('button', { name: 'Go' }));
    expect(await within(nav).findByText(/Enter a byte offset/)).toBeInTheDocument();
  });

  it('offers only a download above the paged cap (FILE_TOO_LARGE)', async () => {
    files['/srv/dump.sql'] = { size: 500 * 1024 * 1024, contentError: { status: 413, code: 'FILE_TOO_LARGE' } };
    renderViewer('/srv/dump.sql');

    const card = await screen.findByTestId('file-download-card');
    expect(within(card).getByText(/too large to view/)).toBeInTheDocument();
    expect(within(card).getByText(/500\.0 MB/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(document.querySelector('.cm-editor')).toBeNull();
  });

  it('never renders a binary file as text', async () => {
    files['/usr/bin/tool'] = { size: 4096, isText: false, mime: 'application/octet-stream' };
    renderViewer('/usr/bin/tool');

    const card = await screen.findByTestId('file-download-card');
    expect(within(card).getByText(/binary file/)).toBeInTheDocument();
    expect(within(card).getByText(/application\/octet-stream/)).toBeInTheDocument();
    expect(contentRequests).toHaveLength(0);
    expect(document.querySelector('.cm-editor')).toBeNull();
  });

  it('turns a FILE_IS_BINARY read into the binary card', async () => {
    files['/srv/blob.txt'] = { size: 100, contentError: { status: 415, code: 'FILE_IS_BINARY' } };
    renderViewer('/srv/blob.txt');
    expect(await screen.findByText(/binary file/)).toBeInTheDocument();
  });

  it('previews an image through a single-use download token, SVG as an <img>', async () => {
    files['/srv/logo.svg'] = { size: 300, mime: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' };
    renderViewer('/srv/logo.svg');

    const img = await screen.findByRole('img', { name: 'logo.svg' });
    expect(img.getAttribute('src')).toMatch(/\/api\/files\/download\/tok-1$/);
    expect(tokenBodies).toEqual([{ path: '/srv/logo.svg' }]);
    expect(document.querySelector('svg[xmlns]')).toBeNull();
    expect(contentRequests).toHaveLength(0);
  });

  it('gives a large image the download card instead of a preview', async () => {
    files['/srv/photo.png'] = { size: 50 * 1024 * 1024, isText: false, mime: 'image/png' };
    renderViewer('/srv/photo.png');
    expect(await screen.findByTestId('file-download-card')).toBeInTheDocument();
    expect(tokenBodies).toHaveLength(0);
  });

  it('shows the API error for a missing file', async () => {
    renderViewer('/nope.txt');
    expect(await screen.findByText('The file does not exist on the server.')).toBeInTheDocument();
  });
});

describe('FileViewer download (#154)', () => {
  it('downloads through a token and the browser native download', async () => {
    files['/srv/app/report.txt'] = { content: 'hello' };
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.getAttribute('href')!, download: this.getAttribute('download')! });
    });
    const user = userEvent.setup();
    render(<FileViewer profileId={PROFILE} path="/srv/app/report.txt" sessionId="22222222-2222-4222-8222-222222222222" />);

    await editorView();
    await user.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(tokenBodies).toEqual([{ path: '/srv/app/report.txt', sessionId: '22222222-2222-4222-8222-222222222222' }]);
    expect(clicks[0]!.href).toMatch(/\/api\/files\/download\/tok-1$/);
    expect(clicks[0]!.download).toBe('');
    // The anchor is removed again.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('downloads from the download-only card', async () => {
    files['/usr/bin/tool'] = { size: 10, isText: false };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderViewer('/usr/bin/tool');

    const card = await screen.findByTestId('file-download-card');
    await user.click(within(card).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(tokenBodies).toEqual([{ path: '/usr/bin/tool' }]);
  });
});

describe('FileViewer modes (#154)', () => {
  it('pretty-prints valid JSON on request', async () => {
    files['/srv/app/config.json'] = { content: '{"a":1,"b":[2]}' };
    const user = userEvent.setup();
    renderViewer('/srv/app/config.json');

    await waitFor(async () => expect(await editorText()).toBe('{"a":1,"b":[2]}'));
    expect(screen.queryByTestId('json-error')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pretty-print' }));
    await waitFor(async () => expect(await editorText()).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}'));
    expect(screen.getByRole('button', { name: 'Pretty-print' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the validation error of invalid JSON and disables pretty-print', async () => {
    files['/srv/app/broken.json'] = { content: '{\n  "a": 1,\n  "b": }\n' };
    renderViewer('/srv/app/broken.json');

    const error = await screen.findByTestId('json-error');
    expect(error).toHaveTextContent('Invalid JSON');
    expect(error).toHaveTextContent('(line 3, column 8)');
    expect(screen.getByRole('button', { name: 'Pretty-print' })).toBeDisabled();
  });

  it('masks .env values until they are revealed', async () => {
    files['/srv/app/.env'] = { content: '# secrets\nDB_PASSWORD=s3cret-value\nAPI_KEY=abc123\n' };
    const user = userEvent.setup();
    renderViewer('/srv/app/.env');

    await waitFor(async () => expect(await editorText()).toBe(`# secrets\nDB_PASSWORD=${ENV_MASK}\nAPI_KEY=${ENV_MASK}\n`));
    expect(screen.getByText(/2 values are hidden/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('s3cret-value');

    await user.click(screen.getByRole('button', { name: 'Reveal values' }));
    await waitFor(async () => expect(await editorText()).toContain('DB_PASSWORD=s3cret-value'));
    await user.click(screen.getByRole('button', { name: 'Hide values' }));
    await waitFor(async () => expect(await editorText()).not.toContain('s3cret-value'));
  });

  it('renders a sanitized Markdown preview', async () => {
    files['/srv/README.md'] = { content: '# Hello\n\n<script>window.pwned = true</script>\n\n**bold**' };
    const user = userEvent.setup();
    renderViewer('/srv/README.md');

    await editorView();
    await user.click(screen.getByRole('button', { name: 'Show preview' }));
    const preview = await screen.findByTestId('markdown-preview');
    expect(within(preview).getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(preview.querySelector('script')).toBeNull();
    expect(preview).toHaveTextContent('<script>window.pwned = true</script>');
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('jumps to the requested line', async () => {
    files['/srv/app/main.sh'] = { content: Array.from({ length: 50 }, (_, i) => `echo ${i + 1}`).join('\n') };
    renderViewer('/srv/app/main.sh', { line: 42 });

    await waitFor(async () => {
      const view = await editorView();
      expect(view.state.doc.length).toBeGreaterThan(0);
      const head = view.state.selection.main.head;
      expect(view.state.doc.lineAt(head).number).toBe(42);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('echo 42');
    });
    expect(screen.getByText('Shell')).toBeInTheDocument();
  });

  it('toggles wrap and line numbers', async () => {
    files['/srv/notes.txt'] = { content: 'a\nb' };
    const user = userEvent.setup();
    renderViewer('/srv/notes.txt');
    await editorView();
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Line numbers' }));
    await waitFor(() => expect(document.querySelector('.cm-lineNumbers')).toBeNull());
    expect(document.querySelector('.cm-lineWrapping')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Wrap lines' }));
    await waitFor(() => expect(document.querySelector('.cm-lineWrapping')).not.toBeNull());
  });

  it('copies the loaded text (masked values stay masked)', async () => {
    files['/srv/.env'] = { content: 'TOKEN=abc\n' };
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderViewer('/srv/.env');
    await editorView();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`TOKEN=${ENV_MASK}\n`));
  });
});

describe('FileViewer log mode (#154)', () => {
  it('strips ANSI escapes and opens at the tail of a paged log', async () => {
    const head = '\u001b[32mINFO\u001b[0m boot\n';
    const content = head + 'x'.repeat(200) + '\n\u001b[31mERROR\u001b[0m failed\n';
    files['/var/log/app.log'] = { content, window: 64 };
    renderViewer('/var/log/app.log');

    await waitFor(() => expect(contentRequests).toHaveLength(2));
    expect(contentRequests[1]!.get('offset')).toBe(String(content.length - 64));
    await waitFor(async () => expect(await editorText()).toMatch(/ERROR failed\n$/));
    expect(await editorText()).not.toContain('\u001b');
    expect(screen.getByText('Log')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.cm-log-error')).not.toBeNull());
  });

  it('follows a growing log by polling its size and reading the new range', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    files['/var/log/app.log'] = { content: 'INFO one\n' };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderViewer('/var/log/app.log');

    await waitFor(async () => expect(await editorText()).toBe('INFO one\n'));
    await user.click(screen.getByRole('button', { name: 'Follow' }));
    expect(screen.getByRole('button', { name: 'Stop following' })).toHaveAttribute('aria-pressed', 'true');

    files['/var/log/app.log'] = { content: 'INFO one\n\u001b[33mWARN\u001b[0m two\n' };
    const before = statRequests;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS);
    });
    await waitFor(async () => expect(await editorText()).toBe('INFO one\nWARN two\n'));
    expect(statRequests).toBe(before + 1);
    expect(contentRequests.at(-1)!.get('offset')).toBe(String('INFO one\n'.length));

    // Nothing new: a stat, no read.
    const reads = contentRequests.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS);
    });
    await waitFor(() => expect(statRequests).toBe(before + 2));
    expect(contentRequests).toHaveLength(reads);

    // Hidden: no polling.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS * 2);
    });
    expect(statRequests).toBe(before + 2);
    visibility.mockRestore();

    // Stopped: no polling.
    await user.click(screen.getByRole('button', { name: 'Stop following' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS * 2);
    });
    expect(statRequests).toBe(before + 2);
  });

  it('stops polling when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    files['/var/log/app.log'] = { content: 'INFO one\n' };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderViewer('/var/log/app.log');
    await waitFor(async () => expect(await editorText()).toBe('INFO one\n'));
    await user.click(screen.getByRole('button', { name: 'Follow' }));
    const before = statRequests;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS * 3);
    });
    expect(statRequests).toBe(before);
  });
});
