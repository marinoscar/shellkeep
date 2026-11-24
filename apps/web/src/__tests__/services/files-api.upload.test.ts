import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteUploadError, isUploadCancelled, uploadRemoteFile } from '../../services/files-api';
import { api } from '../../services/api';

/** A scripted XMLHttpRequest: the test decides when progress and the answer arrive. */
class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (extra = {}) => ({ profileId: 'p 1', dir: '/srv/app', name: 'a b.txt', file: new Blob(['abc']), ...extra });

describe('uploadRemoteFile', () => {
  it('posts the raw bytes with the query, the bearer token and the progress callback', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.spyOn(api, 'getAccessToken').mockReturnValue('tok');
    const onProgress = vi.fn();
    const file = new Blob(['abc']);
    const done = uploadRemoteFile(request({ file, onProgress, overwrite: true, sessionId: 's1' }));
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toMatch(/\/api\//);
    expect(xhr.url.replace(/^https?:\/\/[^/]+/, '')).toBe('/api/server-profiles/p%201/files/upload?path=%2Fsrv%2Fapp&name=a+b.txt&overwrite=true&sessionId=s1');
    expect(xhr.headers).toEqual({ 'Content-Type': 'application/octet-stream', Authorization: 'Bearer tok' });
    expect(xhr.body).toBe(file);
    xhr.upload.onprogress?.({ loaded: 1, total: 3, lengthComputable: true });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 1, total: 3 });
    xhr.answer(201, { data: { path: '/srv/app/a b.txt', name: 'a b.txt', size: 3, overwritten: false } });
    await expect(done).resolves.toMatchObject({ size: 3, overwritten: false });
  });

  it('throws the API\'s code, message and details', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const done = uploadRemoteFile(request());
    FakeXhr.last.answer(409, { code: 'FILE_EXISTS', message: 'exists', details: { size: 5 } });
    const error = await done.catch((e) => e);
    expect(error).toBeInstanceOf(RemoteUploadError);
    expect(error).toMatchObject({ status: 409, code: 'FILE_EXISTS', details: { size: 5 } });
  });

  it('retries once after a token refresh on a 401', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.spyOn(api, 'refreshToken').mockResolvedValue(true);
    const done = uploadRemoteFile(request());
    const first = FakeXhr.last;
    first.answer(401, { code: 'UNAUTHORIZED', message: 'no' });
    await vi.waitFor(() => expect(FakeXhr.last).not.toBe(first));
    FakeXhr.last.answer(201, { data: { path: '/x', name: 'n', size: 3, overwritten: false } });
    await expect(done).resolves.toMatchObject({ name: 'n' });
  });

  it('rejects with an abort at once when the signal fires, and not at all when it already has', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    const done = uploadRemoteFile(request({ signal: controller.signal }));
    controller.abort();
    const error = await done.catch((e) => e);
    expect(isUploadCancelled(error)).toBe(true);
    expect(FakeXhr.last.aborted).toBe(true);
    const before = FakeXhr.last;
    await expect(uploadRemoteFile(request({ signal: controller.signal })).catch((e) => isUploadCancelled(e))).resolves.toBe(true);
    expect(FakeXhr.last).toBe(before);
  });

  it('reports a lost connection as a status-0 error', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const done = uploadRemoteFile(request());
    FakeXhr.last.onerror?.();
    await expect(done).rejects.toMatchObject({ status: 0 });
  });
});
