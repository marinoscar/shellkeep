import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exitCodeFor } from '@marinoscar/platform-cli';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Handler, type Reply, type Seen, type Stub, startStub, stubDeps } from '../__support__/files-stub.js';
import { programWith } from '../__support__/fakes.js';
import { APP_CLI_OPTIONS } from '../app.js';

import { filesCommand } from './files.js';

const SERVER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PROFILES = {
  items: [
    { id: SERVER, name: 'Staging web' },
    { id: OTHER, name: 'Prod db' },
  ],
  total: 2,
  page: 1,
  pageSize: 100,
  totalPages: 1,
};
const FILES = `/api/server-profiles/${SERVER}/files`;

let restore: () => void;
let stub: Stub | undefined;
let dir: string;
beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
  dir = mkdtempSync(join(tmpdir(), 'shellkeep-files-'));
});
afterEach(async () => {
  restore();
  await stub?.close();
  stub = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** The stub answers `/api/server-profiles` itself, then defers to `handler`. */
async function setup(handler: Handler, options: { isTty?: boolean } = {}) {
  stub = await startStub((seen) => (seen.path === '/api/server-profiles' ? { json: PROFILES } : handler(seen)));
  const harness = stubDeps(stub, { cwd: dir, ...options });
  const program = programWith((root) => filesCommand(harness.deps)(root));
  const run = (...args: string[]) => program.parseAsync(['files', ...args], { from: 'user' });
  return { ...harness, run, stub };
}

/** The error a run ends with. */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the command to fail');
}

const error = (status: number, code: string, message: string, details?: unknown): Reply => ({
  status,
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});

describe('server resolution', () => {
  const listing = (): Reply => ({ json: { path: '/home/u', entries: [], truncated: false } });

  it('takes a UUID as the id without looking profiles up', async () => {
    const { run, stub } = await setup(listing);
    await run('ls', SERVER);
    expect(stub.seen.map((s) => s.path)).toEqual([FILES]);
    expect(stub.seen[0]?.query.get('path')).toBe('~');
  });

  it('resolves a profile name, then a case-insensitive one', async () => {
    const { run, stub } = await setup(listing);
    await run('ls', 'Staging web');
    await run('ls', 'prod DB');
    expect(stub.seen.filter((s) => s.path.endsWith('/files')).map((s) => s.path)).toEqual([FILES, `/api/server-profiles/${OTHER}/files`]);
  });

  it('is a usage error (exit 2) for an unknown or an ambiguous name', async () => {
    const { run } = await setup(listing);
    const unknown = await failure(run('ls', 'nope'));
    expect(unknown.message).toContain('no server profile is named "nope"');
    expect(exitCodeFor(unknown)).toBe(2);

    stub = await startStub((seen) =>
      seen.path === '/api/server-profiles' ? { json: { ...PROFILES, items: [PROFILES.items[0], { ...PROFILES.items[0], id: OTHER }] } } : listing(),
    );
    const program = programWith((root) => filesCommand(stubDeps(stub as Stub, { cwd: dir }).deps)(root));
    const ambiguous = await failure(program.parseAsync(['files', 'ls', 'Staging web'], { from: 'user' }));
    expect(ambiguous.message).toContain(OTHER);
    expect(exitCodeFor(ambiguous)).toBe(2);
  });
});

describe('files ls', () => {
  const ENTRIES = [
    { name: 'logs', type: 'dir', size: 4096, mtime: '2026-10-01T10:30:00.000Z', mode: '0755' },
    { name: 'app.conf', type: 'file', size: 1234, mtime: '2026-09-02T08:05:00.000Z', mode: '0644' },
    { name: '.env', type: 'file', size: 12, mtime: '2026-09-02T08:05:00.000Z', mode: '0600' },
    { name: 'current', type: 'symlink', size: 7, mtime: '2026-09-03T00:00:00.000Z', mode: '0777', symlinkTarget: 'logs', targetType: 'dir' },
  ];
  const handler: Handler = () => ({ json: { path: '/home/u', entries: ENTRIES, truncated: false, extra: 'x' } });

  it('prints one name per line, folders with a slash, hiding dotfiles', async () => {
    const { run, out } = await setup(handler);
    await run('ls', SERVER, '/home/u');
    expect(out()).toBe('logs/\napp.conf\ncurrent/\n');
  });

  it('--all shows dotfiles', async () => {
    const { run, out } = await setup(handler);
    await run('ls', SERVER, '--all');
    expect(out()).toContain('.env\n');
  });

  it('--long shows type, mode, size and modified time, and a link target', async () => {
    const { run, out } = await setup(handler);
    await run('ls', SERVER, '-l');
    expect(out().split('\n')).toEqual([
      'd0755  4096  2026-10-01 10:30  logs/',
      '-0644  1234  2026-09-02 08:05  app.conf',
      'l0777     7  2026-09-03 00:00  current/ -> logs',
      '',
    ]);
  });

  it('--json is an explicit projection of the listing', async () => {
    const { run, out } = await setup(handler);
    await run('ls', SERVER, '--json');
    const parsed = JSON.parse(out()) as { path: string; truncated: boolean; entries: Array<Record<string, unknown>> };
    expect(parsed.path).toBe('/home/u');
    expect(parsed.entries.map((e) => e.name)).toEqual(['logs', 'app.conf', 'current']);
    expect(Object.keys(parsed.entries[2] ?? {})).toEqual(['name', 'type', 'size', 'mtime', 'mode', 'symlinkTarget', 'targetType']);
    expect(out()).not.toContain('extra');
  });

  it('says when the server truncated the listing', async () => {
    const { run, err } = await setup(() => ({ json: { path: '/x', entries: [], truncated: true } }));
    await run('ls', SERVER, '/x');
    expect(err()).toContain('truncated');
  });

  it('maps API failures to exit codes: 404 is 3, 401 is 5, an unreachable server is 4', async () => {
    const missing = await setup(() => error(404, 'FILE_NOT_FOUND', 'Nothing exists at the path'));
    expect(exitCodeFor(await failure(missing.run('ls', SERVER, '/nope')))).toBe(3);
    await stub?.close();

    const denied = await setup(() => error(401, 'UNAUTHORIZED', 'Unauthorized'));
    expect(exitCodeFor(await failure(denied.run('ls', SERVER)))).toBe(5);
    await stub?.close();

    const down = await setup(handler);
    await down.stub.close();
    expect(exitCodeFor(await failure(down.run('ls', SERVER)))).toBe(4);
  });
});

/** A faithful content route over a buffer: windows capped, never splitting a character. */
function contentRoute(file: Buffer, cap: number, limit = Number.POSITIVE_INFINITY): Handler {
  return (seen: Seen) => {
    if (seen.path !== `${FILES}/content`) return undefined;
    if (file.length > limit) return error(413, 'FILE_TOO_LARGE', 'The file is too large to view as text', { size: file.length });
    if (file.includes(0)) return error(415, 'FILE_IS_BINARY', 'The file is binary; download it instead');
    const offset = Number(seen.query.get('offset') ?? 0);
    const wanted = Math.min(Number(seen.query.get('length') ?? cap), cap);
    let start = offset;
    while (start < file.length && ((file[start] as number) & 0xc0) === 0x80) start += 1;
    let end = Math.min(file.length, offset + wanted);
    if (end < file.length) while (end > start && ((file[end] as number) & 0xc0) === 0x80) end -= 1;
    if (end < file.length && end > start && ((file[end - 1] as number) & 0xc0) !== 0 && ((file[end - 1] as number) & 0x80) !== 0) {
      // a lead byte whose continuation lies past the end
      let lead = end - 1;
      while (lead > start && ((file[lead] as number) & 0xc0) === 0x80) lead -= 1;
      const need = (file[lead] as number) >= 0xf0 ? 4 : (file[lead] as number) >= 0xe0 ? 3 : (file[lead] as number) >= 0xc0 ? 2 : 1;
      if (lead + need > end) end = lead;
    }
    const slice = file.subarray(start, end);
    return { json: { text: slice.toString('utf8'), offset: start, length: slice.length, size: file.length, eof: end >= file.length } };
  };
}

describe('files cat', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `línea ${i + 1} ✓`).join('\n') + '\n';

  it('reads a large file one window at a time and prints it whole', async () => {
    const text = lines(200);
    const file = Buffer.from(text);
    const { run, out, stub } = await setup(contentRoute(file, 300));
    await run('cat', SERVER, '/var/log/app.log');
    expect(out()).toBe(text);
    const reads = stub.seen.filter((s) => s.path === `${FILES}/content`);
    expect(reads.length).toBeGreaterThan(7);
    expect(reads[0]?.query.get('path')).toBe('/var/log/app.log');
    // each request starts where the previous window ended
    expect(reads.map((r) => Number(r.query.get('offset') ?? 0)).every((o, i, all) => i === 0 || o > (all[i - 1] as number))).toBe(true);
  });

  it('--head N stops reading as soon as it has its lines', async () => {
    const file = Buffer.from(lines(200));
    const { run, out, stub } = await setup(contentRoute(file, 300));
    await run('cat', SERVER, '/f', '--head', '30');
    expect(out()).toBe(lines(30));
    expect(stub.seen.filter((s) => s.path === `${FILES}/content`).length).toBeLessThan(8);
  });

  it('--tail N reads backwards from the end, across windows and multi-byte characters', async () => {
    const text = lines(200);
    const file = Buffer.from(text);
    for (const cap of [300, 301, 307, 4096]) {
      const { run, out, stub } = await setup(contentRoute(file, cap));
      await run('cat', SERVER, '/f', '--tail', '25');
      expect(out()).toBe(text.split('\n').slice(-26).join('\n'));
      if (cap < 4096) expect(stub.seen.filter((s) => s.path === `${FILES}/content`).length).toBeLessThan(12);
      await stub.close();
    }
  });

  it('--tail of a small file and of a file with no trailing newline', async () => {
    const small = await setup(contentRoute(Buffer.from('a\nb\nc'), 1000));
    await small.run('cat', SERVER, '/f', '--tail', '2');
    expect(small.out()).toBe('b\nc');
    await stub?.close();
    const more = await setup(contentRoute(Buffer.from('a\nb\n'), 1000));
    await more.run('cat', SERVER, '/f', '--tail', '10');
    expect(more.out()).toBe('a\nb\n');
  });

  it('--json is one object per window', async () => {
    const { run, out } = await setup(contentRoute(Buffer.from(lines(40)), 200));
    await run('cat', SERVER, '/f', '--json');
    const records = out().trim().split('\n').map((line) => JSON.parse(line) as { offset: number; length: number; eof: boolean; text: string });
    expect(records.length).toBeGreaterThan(2);
    expect(records.map((r) => r.text).join('')).toBe(lines(40));
    expect(records.at(-1)?.eof).toBe(true);
  });

  it('suggests `files get` for a binary file and for FILE_TOO_LARGE, keeping exit code 3', async () => {
    const binary = await setup(contentRoute(Buffer.from([1, 2, 0, 4]), 100));
    const b = await failure(binary.run('cat', SERVER, '/bin/x'));
    expect(b.message).toContain('FILE_IS_BINARY');
    expect(b.message).toContain(`shellkeep files get ${SERVER}`);
    expect(exitCodeFor(b)).toBe(3);
    await stub?.close();

    const large = await setup(contentRoute(Buffer.from('hello'), 100, 2));
    const l = await failure(large.run('cat', SERVER, '/big.log'));
    expect(l.message).toContain('FILE_TOO_LARGE');
    expect(l.message).toContain('shellkeep files get');
    expect(exitCodeFor(l)).toBe(3);
  });

  it('refuses --head with --tail and a bad count (exit 2)', async () => {
    const { run } = await setup(contentRoute(Buffer.from('x'), 10));
    expect(exitCodeFor(await failure(run('cat', SERVER, '/f', '--head', '1', '--tail', '1')))).toBe(2);
    expect(exitCodeFor(await failure(run('cat', SERVER, '/f', '--tail', '0')))).toBe(2);
    expect(exitCodeFor(await failure(run('cat', SERVER, '/f', '--head', 'x')))).toBe(2);
  });
});

describe('files get', () => {
  const TOKEN = 'tok_secret_value';
  const content = Buffer.from('x'.repeat(100_000));
  const route =
    (body: Buffer = content, extra: Partial<Reply> = {}): Handler =>
    (seen) => {
      if (seen.path === `${FILES}/download-token`) return { json: { token: TOKEN, expiresAt: '2026-11-24T00:01:00.000Z' } };
      if (seen.path === `/api/files/download/${TOKEN}`) return { body, ...extra };
      return undefined;
    };

  it('gets a token, streams to disk and leaves no temp file', async () => {
    const { run, out, stub } = await setup(route());
    await run('get', SERVER, '/srv/data/report.csv');
    expect(readFileSync(join(dir, 'report.csv')).equals(content)).toBe(true);
    expect(readdirSync(dir)).toEqual(['report.csv']);
    expect(JSON.parse(stub.seen[0]?.body.toString() ?? '{}')).toEqual({ path: '/srv/data/report.csv' });
    expect(stub.seen[0]?.headers.authorization).toBe('Bearer test-token');
    expect(out()).toBe(`${join(dir, 'report.csv')} (97.7 KiB)\n`);
    expect(out()).not.toContain(TOKEN);
  });

  it('writes into a destination directory, and to a named destination file', async () => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const { run } = await setup(route());
    await run('get', SERVER, '/srv/a.bin', 'sub');
    expect(readdirSync(sub)).toEqual(['a.bin']);
    await run('get', SERVER, '/srv/a.bin', 'renamed.bin');
    expect(readFileSync(join(dir, 'renamed.bin')).equals(content)).toBe(true);
  });

  it('refuses to overwrite without --force, before spending a token, and replaces with it', async () => {
    writeFileSync(join(dir, 'a.bin'), 'old');
    const { run, stub } = await setup(route());
    const refused = await failure(run('get', SERVER, '/srv/a.bin'));
    expect(refused.message).toContain('already exists; use --force');
    expect(exitCodeFor(refused)).toBe(1);
    expect(stub.seen.some((s) => s.path.endsWith('download-token'))).toBe(false);
    expect(readFileSync(join(dir, 'a.bin'), 'utf8')).toBe('old');

    await run('get', SERVER, '/srv/a.bin', '--force');
    expect(readFileSync(join(dir, 'a.bin')).equals(content)).toBe(true);
    expect(readdirSync(dir)).toEqual(['a.bin']);
  });

  it('removes the temp file and keeps an existing file when the body ends short', async () => {
    writeFileSync(join(dir, 'a.bin'), 'old');
    const { run } = await setup(route(Buffer.from('partial'), { declareLength: 5000 }));
    await failure(run('get', SERVER, '/srv/a.bin', '--force'));
    expect(readdirSync(dir)).toEqual(['a.bin']);
    expect(readFileSync(join(dir, 'a.bin'), 'utf8')).toBe('old');
  });

  it('is a usage error when the destination directory does not exist or no name can be derived', async () => {
    const { run } = await setup(route());
    expect(exitCodeFor(await failure(run('get', SERVER, '/srv/a', 'missing/x')))).toBe(2);
    expect(exitCodeFor(await failure(run('get', SERVER, '/srv/a', 'nodir/')))).toBe(2);
    expect(exitCodeFor(await failure(run('get', SERVER, '~')))).toBe(2);
  });

  it('draws progress on a terminal only', async () => {
    const tty = await setup(route(), { isTty: true });
    await tty.run('get', SERVER, '/srv/p.bin');
    expect(tty.err()).toContain('downloading');
    expect(tty.err()).toContain('100%');
    await stub?.close();
    const pipe = await setup(route());
    await pipe.run('get', SERVER, '/srv/q.bin');
    expect(pipe.err()).toBe('');
  });

  it('--json reports the path, destination and size, and a missing file is exit 3', async () => {
    const { run, out } = await setup(route());
    await run('get', SERVER, '/srv/j.bin', '--json');
    expect(JSON.parse(out())).toEqual({ path: '/srv/j.bin', dest: join(dir, 'j.bin'), bytes: 100_000 });
    await stub?.close();
    const missing = await setup(() => error(404, 'FILE_NOT_FOUND', 'Nothing exists at the path'));
    expect(exitCodeFor(await failure(missing.run('get', SERVER, '/nope')))).toBe(3);
  });
});

describe('files put', () => {
  const upload =
    (reply: Reply = { status: 201, json: { path: '/srv/in/up.bin', name: 'up.bin', size: 300_000, overwritten: false } }): Handler =>
    (seen) =>
      seen.path === `${FILES}/upload` ? reply : undefined;

  it('streams the file as application/octet-stream with its length', async () => {
    const bytes = Buffer.alloc(300_000, 7);
    writeFileSync(join(dir, 'up.bin'), bytes);
    const { run, out, stub } = await setup(upload());
    await run('put', SERVER, 'up.bin', '/srv/in');
    const sent = stub.seen[0] as Seen;
    expect(sent.method).toBe('POST');
    expect(sent.query.get('path')).toBe('/srv/in');
    expect(sent.query.get('name')).toBe('up.bin');
    expect(sent.query.get('overwrite')).toBe('false');
    expect(sent.headers['content-type']).toBe('application/octet-stream');
    expect(sent.headers['content-length']).toBe('300000');
    expect(sent.headers.authorization).toBe('Bearer test-token');
    expect(sent.body.equals(bytes)).toBe(true);
    expect(out()).toBe('/srv/in/up.bin (292.97 KiB)\n'.replace('292.97', '293.0'));
  });

  it('--name and --overwrite are sent, and --json prints the result', async () => {
    writeFileSync(join(dir, 'local.txt'), 'hi');
    const { run, out, stub } = await setup(upload({ status: 201, json: { path: '/d/n.txt', name: 'n.txt', size: 2, overwritten: true } }));
    await run('put', SERVER, 'local.txt', '/d', '--name', 'n.txt', '--overwrite', '--json');
    expect(stub.seen[0]?.query.get('name')).toBe('n.txt');
    expect(stub.seen[0]?.query.get('overwrite')).toBe('true');
    expect(JSON.parse(out())).toEqual({ path: '/d/n.txt', name: 'n.txt', size: 2, overwritten: true });
  });

  it('on 409 says to use --overwrite (exit 3)', async () => {
    writeFileSync(join(dir, 'up.bin'), 'x');
    const { run } = await setup(upload(error(409, 'FILE_EXISTS', 'A file with that name already exists', { size: 4 })));
    const failed = await failure(run('put', SERVER, 'up.bin', '/srv/in'));
    expect(failed.message).toContain('FILE_EXISTS');
    expect(failed.message).toContain('--overwrite');
    expect(exitCodeFor(failed)).toBe(3);
  });

  it('is a usage error for a missing file or a directory, before any request', async () => {
    mkdirSync(join(dir, 'folder'));
    const { run, stub } = await setup(upload());
    expect(exitCodeFor(await failure(run('put', SERVER, 'nope.txt', '/d')))).toBe(2);
    expect(exitCodeFor(await failure(run('put', SERVER, 'folder', '/d')))).toBe(2);
    expect(stub.seen).toEqual([]);
  });

  it('draws upload progress on a terminal', async () => {
    writeFileSync(join(dir, 'up.bin'), Buffer.alloc(200_000));
    const { run, err } = await setup(upload(), { isTty: true });
    await run('put', SERVER, 'up.bin', '/srv/in');
    expect(err()).toContain('uploading');
    expect(err()).toContain('100%');
  });
});

describe('files archive', () => {
  const ARCHIVE = '33333333-3333-4333-8333-333333333333';
  const SIGNED = 'sig=very-secret-signature';
  const tarball = Buffer.from('not really a tarball '.repeat(1000));

  /** The archive routes, with a scripted sequence of statuses. */
  const route =
    (statuses: Array<Record<string, unknown>>, options: { url?: string } = {}): Handler =>
    (seen) => {
      if (seen.path === `${FILES}/archive`) return { status: 202, json: { archiveId: ARCHIVE, jobId: 'job', status: 'pending' } };
      if (seen.path === `/api/files/archives/${ARCHIVE}`) {
        const count = seen.url.length > 0 ? statusCalls++ : 0;
        return { json: { archiveId: ARCHIVE, sizeBytes: null, warning: null, errorCode: null, errorMessage: null, ...(statuses[Math.min(count, statuses.length - 1)] ?? {}) } };
      }
      if (seen.path === `/api/files/archives/${ARCHIVE}/download`) {
        return { json: { url: options.url ?? `${stub?.url}/storage/archive.tar.gz?${SIGNED}`, filename: 'logs.tar.gz', expiresAt: '2026-11-24T00:15:00.000Z' } };
      }
      if (seen.path === '/storage/archive.tar.gz') return { body: tarball };
      return undefined;
    };
  let statusCalls = 0;
  beforeEach(() => {
    statusCalls = 0;
  });

  it('starts the job, polls until ready, then downloads through the presigned URL without the token', async () => {
    const { run, out, sleeps, stub } = await setup(route([{ status: 'pending' }, { status: 'running' }, { status: 'ready', sizeBytes: tarball.length }]));
    await run('archive', SERVER, '/var/logs');
    expect(JSON.parse(stub.seen.find((s) => s.path === `${FILES}/archive`)?.body.toString() ?? '{}')).toEqual({ path: '/var/logs' });
    expect(stub.seen.filter((s) => s.path === `/api/files/archives/${ARCHIVE}`)).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
    const download = stub.seen.find((s) => s.path === '/storage/archive.tar.gz');
    expect(download?.headers.authorization).toBeUndefined();
    expect(readFileSync(join(dir, 'logs.tar.gz')).equals(tarball)).toBe(true);
    expect(out()).toBe(`${join(dir, 'logs.tar.gz')} (20.5 KiB)\n`);
    expect(out()).not.toContain('signature');
  });

  it('shows progress dots on a terminal while waiting', async () => {
    const { run, err } = await setup(route([{ status: 'running' }, { status: 'running' }, { status: 'ready' }]), { isTty: true });
    await run('archive', SERVER, '/var/logs');
    expect(err()).toContain('..\n');
  });

  it('--no-wait prints the archive id and does not poll', async () => {
    const { run, out, stub } = await setup(route([{ status: 'ready' }]));
    await run('archive', SERVER, '/var/logs', '--no-wait');
    expect(out()).toBe(`${ARCHIVE}\n`);
    expect(stub.seen.map((s) => s.path)).toEqual([`${FILES}/archive`]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('--no-wait --json prints the request answer', async () => {
    const { run, out } = await setup(route([{ status: 'ready' }]));
    await run('archive', SERVER, '/var/logs', '--no-wait', '--json');
    expect(JSON.parse(out())).toMatchObject({ archiveId: ARCHIVE, status: 'pending', dest: null });
  });

  it('writes into a destination directory and refuses to overwrite without --force', async () => {
    mkdirSync(join(dir, 'out'));
    const { run } = await setup(route([{ status: 'ready' }]));
    await run('archive', SERVER, '/var/logs', 'out');
    expect(readdirSync(join(dir, 'out'))).toEqual(['logs.tar.gz']);
    const refused = await failure(run('archive', SERVER, '/var/logs', 'out'));
    expect(refused.message).toContain('use --force');
    await run('archive', SERVER, '/var/logs', 'out', '--force');
    expect(readdirSync(join(dir, 'out'))).toEqual(['logs.tar.gz']);
  });

  it('a failed archive is exit 1 with the reason', async () => {
    const { run } = await setup(route([{ status: 'running' }, { status: 'failed', errorCode: 'ARCHIVE_TOO_LARGE', errorMessage: 'The folder is larger than the limit' }]));
    const failed = await failure(run('archive', SERVER, '/big'));
    expect(failed.message).toContain('The folder is larger than the limit');
    expect(failed.message).toContain('ARCHIVE_TOO_LARGE');
    expect(exitCodeFor(failed)).toBe(1);
  });

  it('an expired archive and a timeout are exit 1; a tar warning is shown', async () => {
    const expired = await setup(route([{ status: 'expired' }]));
    expect(exitCodeFor(await failure(expired.run('archive', SERVER, '/x')))).toBe(1);
    await stub?.close();

    statusCalls = 0;
    const slow = await setup(route([{ status: 'running' }]));
    const timedOut = await failure(slow.run('archive', SERVER, '/x', '--timeout', '10'));
    expect(timedOut.message).toContain(`archive id ${ARCHIVE}`);
    expect(exitCodeFor(timedOut)).toBe(1);
    await stub?.close();

    statusCalls = 0;
    const warned = await setup(route([{ status: 'ready', warning: 'a file changed as we read it' }]));
    await warned.run('archive', SERVER, '/x');
    expect(warned.err()).toContain('warning: a file changed as we read it');
  });

  it('a presigned-URL failure never prints the signature', async () => {
    const { run } = await setup((seen) => (seen.path === '/storage/archive.tar.gz' ? error(403, 'EXPIRED', 'Request has expired') : route([{ status: 'ready' }])(seen)));
    const failed = await failure(run('archive', SERVER, '/x'));
    expect(failed.message).not.toContain('signature');
    expect(failed.message).not.toContain('sig=');
    expect(exitCodeFor(failed)).toBe(3);
  });

  it('rejects a bad --timeout (exit 2)', async () => {
    const { run } = await setup(route([{ status: 'ready' }]));
    expect(exitCodeFor(await failure(run('archive', SERVER, '/x', '--timeout', '0')))).toBe(2);
  });
});
