import { http, HttpResponse } from 'msw';
import type { RemoteDirEntry } from '../../../../services/files-api';

// A fake files API for the file browser tests (#156): a small tree under an
// invented home directory, a session working directory, and error paths.

export const PROFILE = '11111111-1111-4111-8111-111111111111';
export const SESSION = '22222222-2222-4222-8222-222222222222';
export const HOME = '/home/person-a';
export const CWD = '/srv/app';
const MB = 1024 * 1024;

export function entry(name: string, extra: Partial<RemoteDirEntry> = {}): RemoteDirEntry {
  return {
    name,
    type: 'file',
    size: 100,
    mtime: new Date(Date.now() - 5 * 60_000).toISOString(),
    mode: '0644',
    symlinkTarget: null,
    targetType: null,
    ...extra,
  };
}

export const TREE: Record<string, RemoteDirEntry[]> = {
  [HOME]: [
    entry('projects', { type: 'dir', size: 4096 }),
    entry('.config', { type: 'dir', size: 4096 }),
    entry('notes.txt', { size: 1200, mtime: '2026-11-20T00:00:00.000Z' }),
    entry('.bashrc', { size: 300 }),
    entry('big.log', { size: 5 * MB, mtime: '2026-11-22T00:00:00.000Z' }),
    entry('huge.bin', { size: 300 * MB, mtime: '2026-11-21T00:00:00.000Z' }),
  ],
  [`${HOME}/projects`]: [entry('app.ts', { size: 2048 })],
  '/home': [entry('person-a', { type: 'dir', size: 4096 })],
  '/': [entry('home', { type: 'dir' }), entry('srv', { type: 'dir' })],
  [CWD]: [entry('logs', { type: 'dir', size: 4096 }), entry('server.log', { size: 900 })],
  [`${CWD}/logs`]: [entry('error.log', { size: 50 })],
  '/srv': [entry('app', { type: 'dir' })],
};

export interface ListRequest {
  path: string;
  sessionId: string | null;
}

/** Installs the handlers; returns the requests seen. `cwd` is read per request. */
export function fakeFilesHandlers(state: { cwd: string; requests: ListRequest[]; failProfile?: { status: number; code: string } }) {
  const resolve = (raw: string): string => {
    if (raw === '~') return HOME;
    if (raw.startsWith('~/')) return `${HOME}/${raw.slice(2)}`;
    if (raw === '.') return state.cwd;
    if (raw.startsWith('/')) return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
    return `${state.cwd}/${raw}`;
  };
  return [
    http.get('*/api/server-profiles/:id/files', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const raw = params.get('path') ?? '~';
      state.requests.push({ path: raw, sessionId: params.get('sessionId') });
      if (state.failProfile) {
        return HttpResponse.json({ code: state.failProfile.code, message: 'refused' }, { status: state.failProfile.status });
      }
      const path = resolve(raw);
      if (path === '/root') return HttpResponse.json({ code: 'FILE_PERMISSION_DENIED', message: 'denied' }, { status: 403 });
      const entries = TREE[path];
      if (!entries) return HttpResponse.json({ code: 'FILE_NOT_FOUND', message: 'missing' }, { status: 404 });
      return HttpResponse.json({ data: { path, entries, truncated: false } });
    }),
  ];
}
