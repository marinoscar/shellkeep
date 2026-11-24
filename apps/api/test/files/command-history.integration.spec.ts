// =============================================================================
// Command history over a real ssh2 SFTP server (issue #173)
// =============================================================================
//
// The REAL controller, `CommandHistoryService`, `SftpService` and `SshConnectionFactory` over an
// in-process SFTP server whose root is the login home. Only the access decision (profile and
// session services) and the settings are doubles; they refuse another user with a 404 as
// `AccessPolicy` does. The server also accepts exec: the spec proves no command is ever run.
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, NotFoundException } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';

import { PrismaService } from '../../src/prisma/prisma.service';
import { CommandHistoryController } from '../../src/files/command-history/command-history.controller';
import { CommandHistoryService, HISTORY_REQUESTS_PER_MINUTE } from '../../src/files/command-history/command-history.service';
import { MAX_HISTORY_TAIL_BYTES } from '../../src/files/command-history/history-parse';
import { FilesRateLimiter } from '../../src/files/files-rate-limiter';
import { SftpService } from '../../src/files/sftp.service';
import { DEFAULT_FILES_SYSTEM_SETTINGS } from '../../src/files/settings/files.system-settings';
import { ServerProfilesService } from '../../src/server-profiles/server-profiles.service';
import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import { SessionsService } from '../../src/terminal/sessions.service';
import { withoutAuthGuards } from '../helpers/allow-guards';
import { startSftpTestServer, type SftpTestServer } from './sftp-test-server';

const ORG = '11111111-2222-4333-8444-555555555555';
const OWNER = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PROFILE = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';
const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const GH_TOKEN = `ghp_${'a1B2'.repeat(10)}`;

describe('command history over SFTP', () => {
  let root: string;
  let server: SftpTestServer;
  let app: NestFastifyApplication;
  let service: CommandHistoryService;
  let limiter: FilesRateLimiter;
  let sessionStatus: string;
  let clock: number;
  let profileCalls: jest.Mock;

  const as = (userId: string) => ({ 'x-test-user': userId });
  const url = () => `/sessions/${SESSION}/command-history`;
  const get = (query: Record<string, string | number> = {}, user = OWNER) => request(app.getHttpServer()).get(url()).query(query).set(as(user));
  const write = (name: string, text: string, mtimeSeconds?: number): void => {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    if (mtimeSeconds) utimesSync(path, mtimeSeconds, mtimeSeconds);
  };
  const commands = (body: { entries: Array<{ command: string }> }): string[] => body.entries.map((e) => e.command);

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    root = mkdtempSync(join(tmpdir(), 'cmd-history-'));
    server = await startSftpTestServer({ root, exec: true });
  });

  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    rmSync(join(root, '.bash_history'), { force: true });
    rmSync(join(root, '.zsh_history'), { force: true });
    rmSync(join(root, '.local'), { recursive: true, force: true });
    sessionStatus = 'active';
    clock = 1_000_000;
    profileCalls = jest.fn();

    const profile = {
      id: PROFILE, userId: OWNER, orgId: ORG, hostname: '127.0.0.1', port: server.port, username: server.username,
      authMethod: 'password', password: server.password, fingerprint: server.fingerprint, hostKeyAlgorithm: 'ssh-ed25519',
    };
    const profiles = {
      getDecryptedProfile: jest.fn(async (id: string, principal: { userId: string }, use: string) => {
        profileCalls(use);
        if (id !== PROFILE || principal.userId !== OWNER) throw new NotFoundException('Server profile not found');
        return profile;
      }),
    };
    const sessions = {
      findOne: jest.fn(async (id: string, scope: { userId: string }) => {
        if (id !== SESSION || scope.userId !== OWNER) throw new NotFoundException('session');
        return { id, serverProfileId: PROFILE, status: sessionStatus, tmuxSessionId: 'abc' };
      }),
    };
    const settings = { getNamespace: jest.fn(async (key: string) => (key === 'files' ? { ...DEFAULT_FILES_SYSTEM_SETTINGS, sftpTimeoutSeconds: 10 } : { hostKeyPolicy: 'strict' })) };

    const moduleRef = await withoutAuthGuards(
      Test.createTestingModule({
        controllers: [CommandHistoryController],
        providers: [
          { provide: APP_PIPE, useClass: ZodValidationPipe },
          CommandHistoryService, SftpService, SshConnectionFactory, FilesRateLimiter,
          { provide: ServerProfilesService, useValue: profiles },
          { provide: SessionsService, useValue: sessions },
          { provide: SystemSettingsService, useValue: settings },
          { provide: AUDIT_SINK, useValue: { record: jest.fn() } },
          { provide: PrismaService, useValue: { serverProfile: { updateMany: jest.fn(), findFirst: jest.fn() } } },
        ],
      }),
    ).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook('onRequest', (req: any, _reply: unknown, done: () => void) => {
      const userId = req.headers['x-test-user'];
      if (userId) req.principal = { kind: 'user', userId, email: 'person-a@example.test', credential: 'session', roles: [], permissions: ['sessions:write'], activeOrgId: ORG };
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = moduleRef.get(CommandHistoryService);
    service.now = () => clock;
    limiter = moduleRef.get(FilesRateLimiter);
  });

  afterEach(async () => {
    await app.close();
  });

  it('reads bash history newest first, deduped, with a limit and a search', async () => {
    write('.bash_history', 'ls\ncd /var/log\nls\ngit status\n#1700000000\ntail -f app.log\n');
    const res = await get().expect(200);
    expect(res.body.shell).toBe('bash');
    expect(commands(res.body)).toEqual(['tail -f app.log', 'git status', 'ls', 'cd /var/log']);
    expect(res.body).toMatchObject({ truncated: false, dropped: 0 });
    expect(commands((await get({ limit: 2 }).expect(200)).body)).toEqual(['tail -f app.log', 'git status']);
    expect(commands((await get({ query: 'GIT' }).expect(200)).body)).toEqual(['git status']);
  });

  it('reads the zsh extended format and the fish format', async () => {
    write('.zsh_history', ': 1700000000:0;git pull\n: 1700000001:0;make build\n');
    expect(commands((await get().expect(200)).body)).toEqual(['make build', 'git pull']);
    service['cache'].clear();
    rmSync(join(root, '.zsh_history'));
    write('.local/share/fish/fish_history', '- cmd: echo hi\n  when: 1\n- cmd: ls -la\n  when: 2\n  paths:\n    - /tmp\n');
    const fish = await get().expect(200);
    expect(fish.body.shell).toBe('fish');
    expect(commands(fish.body)).toEqual(['ls -la', 'echo hi']);
  });

  it('uses the history file written most recently', async () => {
    write('.bash_history', 'old bash command\n', 1_600_000_000);
    write('.zsh_history', ': 1:0;recent zsh command\n', 1_700_000_000);
    const res = await get().expect(200);
    expect(res.body.shell).toBe('zsh');
    expect(commands(res.body)).toEqual(['recent zsh command']);
  });

  it('answers an empty list and no shell when there is no history file', async () => {
    const res = await get().expect(200);
    expect(res.body).toEqual({ shell: null, entries: [], truncated: false, dropped: 0 });
  });

  it('reads at most the last 256 KB and never returns a cut line', async () => {
    const line = (i: number) => `echo command-number-${String(i).padStart(6, '0')}\n`;
    let text = '';
    for (let i = 0; text.length < MAX_HISTORY_TAIL_BYTES * 2; i++) text += line(i);
    write('.bash_history', text);
    const res = await get({ limit: 500 }).expect(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.entries).toHaveLength(500);
    expect(res.body.entries.every((e: { command: string }) => /^echo command-number-\d{6}$/.test(e.command))).toBe(true);
    const last = text.trimEnd().split('\n').pop();
    expect(res.body.entries[0].command).toBe(last);
  });

  it('masks secrets, drops whole-secret entries and never searches masked values', async () => {
    write('.bash_history', [
      'sshpass -p hunter2 ssh deploy@host', 'mysql -u root -phunter2 app', 'export DB_PASS=hunter2',
      'git clone https://person-a:hunter2@example.test/r.git', 'curl --token hunter2 https://example.test',
      GH_TOKEN, 'ls',
    ].join('\n') + '\n');
    const res = await get().expect(200);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(JSON.stringify(res.body)).not.toContain(GH_TOKEN);
    expect(res.body.dropped).toBe(1);
    expect(res.body.entries.filter((e: { masked: boolean }) => e.masked)).toHaveLength(5);
    expect(commands(res.body)).toContain('export DB_PASS=[REDACTED:credential_assignment]');
    expect((await get({ query: 'hunter2' }).expect(200)).body.entries).toEqual([]);
  });

  it('never runs a command on the server', async () => {
    write('.bash_history', 'ls\n');
    await get().expect(200);
    expect(server.execs).toEqual([]);
  });

  it('checks the terminal connect rule on every request and 404s another user', async () => {
    write('.bash_history', 'ls\n');
    await get().expect(200);
    expect(profileCalls).toHaveBeenCalledWith('connect');
    const other = await get({}, OTHER).expect(404);
    expect(JSON.stringify(other.body)).not.toContain('ls');
    await request(app.getHttpServer()).get(`/sessions/00000000-0000-4000-8000-000000000000/command-history`).set(as(OWNER)).expect(404);
  });

  it('refuses a terminated session', async () => {
    write('.bash_history', 'ls\n');
    sessionStatus = 'terminated';
    await get().expect(400);
  });

  it('validates the query', async () => {
    await get({ limit: 501 }).expect(400);
    await get({ limit: 0 }).expect(400);
    await get({ query: 'x'.repeat(201) }).expect(400);
  });

  it('caches for 30 seconds per session, then reads again', async () => {
    write('.bash_history', 'first\n');
    expect(commands((await get().expect(200)).body)).toEqual(['first']);
    const connections = server.stats.connections;
    write('.bash_history', 'first\nsecond\n');
    expect(commands((await get().expect(200)).body)).toEqual(['first']);
    expect(server.stats.connections).toBe(connections);
    clock += 31_000;
    expect(commands((await get().expect(200)).body)).toEqual(['second', 'first']);
  });

  it('rate limits per user with 429', async () => {
    write('.bash_history', 'ls\n');
    for (let i = 0; i < HISTORY_REQUESTS_PER_MINUTE; i++) await get().expect(200);
    const res = await get().expect(429);
    expect(res.body.code).toBe('FILES_RATE_LIMITED');
    limiter.now = () => Date.now() + 61_000;
    await get().expect(200);
  });
});
