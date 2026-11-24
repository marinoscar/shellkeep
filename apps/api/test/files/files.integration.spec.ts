// =============================================================================
// The files API against a real ssh2 SFTP server (issue #153)
// =============================================================================
//
// The REAL controllers, `FilesService`, `SftpService` and `SshConnectionFactory` over an
// in-process SFTP server serving a temp directory. Only the access decision (the server profile
// service), the session lookup and the settings are doubles; the double of the profile service
// refuses a profile of another user with a 404, exactly as `AccessPolicy` does.
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { DownloadTokenStore } from '../../src/files/download-token.store';
import { FilesController } from '../../src/files/files.controller';
import { FilesDownloadController } from '../../src/files/files-download.controller';
import { FilesRateLimiter } from '../../src/files/files-rate-limiter';
import { FilesService } from '../../src/files/files.service';
import { SftpService } from '../../src/files/sftp.service';
import { DEFAULT_FILES_SYSTEM_SETTINGS, type FilesSystemSettings } from '../../src/files/settings/files.system-settings';
import { ServerProfilesService } from '../../src/server-profiles/server-profiles.service';
import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import { SessionHistoryService } from '../../src/terminal/session-history.service';
import { SessionsService } from '../../src/terminal/sessions.service';
import { withoutAuthGuards } from '../helpers/allow-guards';
import { startSftpTestServer, type SftpTestServer } from './sftp-test-server';

const ORG = '11111111-2222-4333-8444-555555555555';
const OWNER = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PROFILE = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';
const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('files API over SFTP', () => {
  let root: string;
  let server: SftpTestServer;
  let app: NestFastifyApplication;
  let tokens: DownloadTokenStore;
  let limiter: FilesRateLimiter;
  let settings: FilesSystemSettings;
  let audit: jest.Mock;
  let sessionCwd: string | null;
  let sessionProfile: string;

  const as = (userId: string) => ({ 'x-test-user': userId });
  const http = () => request(app.getHttpServer());
  const base = () => `/server-profiles/${PROFILE}/files`;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    root = mkdtempSync(join(tmpdir(), 'files-api-'));
    mkdirSync(join(root, 'logs'));
    mkdirSync(join(root, 'zdir'));
    writeFileSync(join(root, 'notes.txt'), 'line one\nline two €\n');
    writeFileSync(join(root, 'logs', 'app.log'), 'ERROR boom\n');
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0xff, 0x00]));
    writeFileSync(join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(5000));
    writeFileSync(join(root, 'empty.txt'), '');
    writeFileSync(join(root, 'sp ace;$(id).txt'), 'odd name');
    symlinkSync(join(root, 'notes.txt'), join(root, 'link-to-notes'));
    symlinkSync(join(root, 'nowhere'), join(root, 'broken-link'));
    symlinkSync(join(root, 'logs'), join(root, 'link-to-logs'));
    server = await startSftpTestServer({ root });
  });

  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    settings = { ...DEFAULT_FILES_SYSTEM_SETTINGS, fullViewMaxBytes: 64 * 1024, sftpTimeoutSeconds: 10 };
    audit = jest.fn().mockResolvedValue(undefined);
    sessionCwd = null;
    sessionProfile = PROFILE;
    server.readDelayMs = 0;
    await buildApp();
  });

  /** (Re)builds the app over the current `server`; the profile double reads it lazily. */
  async function buildApp(): Promise<void> {
    const profile = (userId: string) => ({
      id: PROFILE,
      userId,
      orgId: ORG,
      hostname: '127.0.0.1',
      port: server.port,
      username: server.username,
      authMethod: 'password',
      password: server.password,
      fingerprint: server.fingerprint,
      hostKeyAlgorithm: 'ssh-ed25519',
    });
    const profiles = {
      getDecryptedProfile: jest.fn(async (id: string, principal: { userId: string }) => {
        if (id !== PROFILE || principal.userId !== OWNER) throw new NotFoundException('Server profile not found');
        return profile(OWNER);
      }),
      getDecryptedProfileForSession: jest.fn(async (id: string, scope: { userId: string }) => {
        if (id !== PROFILE || scope.userId !== OWNER) throw new NotFoundException('Server profile not found');
        return profile(OWNER);
      }),
    };
    const sessions = {
      findOne: jest.fn(async (id: string, scope: { userId: string }) => {
        if (id !== SESSION || scope.userId !== OWNER) throw new NotFoundException('session');
        return { id, serverProfileId: sessionProfile, status: 'active', tmuxSessionId: 'abc' };
      }),
    };
    const history = { currentPath: jest.fn(async () => sessionCwd) };
    const settingsService = {
      getNamespace: jest.fn(async (key: string) => (key === 'files' ? settings : { hostKeyPolicy: 'strict' })),
    };

    const moduleRef = await withoutAuthGuards(
      Test.createTestingModule({
        controllers: [FilesController, FilesDownloadController],
        providers: [
          { provide: APP_PIPE, useClass: ZodValidationPipe },
          FilesService,
          SftpService,
          SshConnectionFactory,
          DownloadTokenStore,
          FilesRateLimiter,
          { provide: ServerProfilesService, useValue: profiles },
          { provide: SessionsService, useValue: sessions },
          { provide: SessionHistoryService, useValue: history },
          { provide: SystemSettingsService, useValue: settingsService },
          { provide: AUDIT_SINK, useValue: { record: audit } },
          { provide: PrismaService, useValue: { serverProfile: { updateMany: jest.fn(), findFirst: jest.fn() } } },
        ],
      }),
    ).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook('onRequest', (req: any, _reply: unknown, done: () => void) => {
      const userId = req.headers['x-test-user'];
      if (userId) {
        req.principal = {
          kind: 'user', userId, email: 'person-a@example.test', credential: 'session', roles: [],
          permissions: ['sessions:write'], activeOrgId: ORG,
        };
      }
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    tokens = moduleRef.get(DownloadTokenStore);
    limiter = moduleRef.get(FilesRateLimiter);
  }

  afterEach(async () => {
    await app.close();
  });

  describe('list', () => {
    it('lists the home directory, directories first, with types, sizes, modes and link targets', async () => {
      const res = await http().get(base()).set(as(OWNER)).expect(200);
      expect(res.body.path).toBe(require('node:fs').realpathSync(root));
      const names = res.body.entries.map((e: { name: string }) => e.name);
      expect(names.slice(0, 3)).toEqual(['link-to-logs', 'logs', 'zdir']);
      const byName = Object.fromEntries(res.body.entries.map((e: { name: string }) => [e.name, e]));
      expect(byName['notes.txt']).toMatchObject({ type: 'file', size: 'line one\nline two €\n'.length + 2, symlinkTarget: null });
      expect(byName['notes.txt'].mode).toMatch(/^0[0-7]{3}$/);
      expect(Date.parse(byName['notes.txt'].mtime)).not.toBeNaN();
      expect(byName['logs'].type).toBe('dir');
      expect(byName['link-to-notes']).toMatchObject({ type: 'symlink', symlinkTarget: join(root, 'notes.txt'), targetType: 'file' });
      expect(byName['link-to-logs']).toMatchObject({ type: 'symlink', targetType: 'dir' });
      expect(byName['broken-link']).toMatchObject({ type: 'symlink', targetType: null });
      expect(names).not.toContain('.');
      expect(res.body.truncated).toBe(false);
    });

    it('lists a sub directory by absolute and by ~ relative path', async () => {
      const abs = await http().get(base()).query({ path: join(root, 'logs') }).set(as(OWNER)).expect(200);
      expect(abs.body.entries.map((e: { name: string }) => e.name)).toEqual(['app.log']);
      const rel = await http().get(base()).query({ path: '~/logs' }).set(as(OWNER)).expect(200);
      expect(rel.body.entries.map((e: { name: string }) => e.name)).toEqual(['app.log']);
    });

    it('resolves a relative path against the session working directory', async () => {
      sessionCwd = join(root, 'logs');
      const res = await http().get(base()).query({ path: '.', sessionId: SESSION }).set(as(OWNER)).expect(200);
      expect(res.body.entries.map((e: { name: string }) => e.name)).toEqual(['app.log']);
      const file = await http().get(`${base()}/stat`).query({ path: 'app.log', sessionId: SESSION }).set(as(OWNER)).expect(200);
      expect(file.body.path).toBe(join(require('node:fs').realpathSync(root), 'logs', 'app.log'));
    });

    it('falls back to home when the session cwd is unknown, and 404s a session of another profile', async () => {
      await http().get(base()).query({ path: 'logs', sessionId: SESSION }).set(as(OWNER)).expect(200);
      sessionProfile = '00000000-0000-4000-8000-000000000000';
      await http().get(base()).query({ path: 'logs', sessionId: SESSION }).set(as(OWNER)).expect(404);
    });

    it('answers FILE_NOT_FOUND and FILE_NOT_A_DIRECTORY with codes', async () => {
      const missing = await http().get(base()).query({ path: '/no/such/dir' }).set(as(OWNER)).expect(404);
      expect(missing.body.code).toBe('FILE_NOT_FOUND');
      const file = await http().get(base()).query({ path: join(root, 'notes.txt') }).set(as(OWNER)).expect(400);
      expect(file.body.code).toBe('FILE_NOT_A_DIRECTORY');
    });

    it('rejects a NUL byte in the path with 400', async () => {
      const res = await http().get(base()).query({ path: '/etc/pass\u0000wd' }).set(as(OWNER)).expect(400);
      expect(res.body.code).toBe('FILE_PATH_INVALID');
    });
  });

  describe('stat', () => {
    it('describes a text file with mime and isText', async () => {
      const res = await http().get(`${base()}/stat`).query({ path: join(root, 'notes.txt') }).set(as(OWNER)).expect(200);
      expect(res.body).toMatchObject({ name: 'notes.txt', type: 'file', mime: 'text/plain', isText: true });
    });

    it('marks a binary file isText false and a directory as a directory', async () => {
      const bin = await http().get(`${base()}/stat`).query({ path: join(root, 'blob.bin') }).set(as(OWNER)).expect(200);
      expect(bin.body).toMatchObject({ isText: false, mime: 'application/octet-stream' });
      const dir = await http().get(`${base()}/stat`).query({ path: join(root, 'logs') }).set(as(OWNER)).expect(200);
      expect(dir.body).toMatchObject({ type: 'dir', mime: 'inode/directory', isText: false });
    });

    it('follows a link for size and text detection but reports the link', async () => {
      const res = await http().get(`${base()}/stat`).query({ path: join(root, 'link-to-notes') }).set(as(OWNER)).expect(200);
      expect(res.body).toMatchObject({ type: 'symlink', targetType: 'file', isText: true, symlinkTarget: join(root, 'notes.txt') });
    });

    it('treats an empty file as text and 404s a missing one', async () => {
      const res = await http().get(`${base()}/stat`).query({ path: join(root, 'empty.txt') }).set(as(OWNER)).expect(200);
      expect(res.body).toMatchObject({ size: 0, isText: true });
      await http().get(`${base()}/stat`).query({ path: join(root, 'missing') }).set(as(OWNER)).expect(404);
    });
  });

  describe('content', () => {
    it('reads a small file whole', async () => {
      const res = await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt') }).set(as(OWNER)).expect(200);
      expect(res.body).toEqual({ text: 'line one\nline two €\n', offset: 0, length: 'line one\nline two €\n'.length + 2, size: 'line one\nline two €\n'.length + 2, eof: true });
    });

    it('reads ranges and chains them with offset + length', async () => {
      settings.fullViewMaxBytes = 64 * 1024;
      const first = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt'), length: 2000 }).set(as(OWNER)).expect(200);
      expect(first.body).toMatchObject({ offset: 0, length: 2000, size: 5000, eof: false });
      const second = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt'), offset: 2000, length: 2000 }).set(as(OWNER)).expect(200);
      expect(second.body).toMatchObject({ offset: 2000, length: 2000, eof: false });
      const last = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt'), offset: 4000, length: 2000 }).set(as(OWNER)).expect(200);
      expect(last.body).toMatchObject({ offset: 4000, length: 1000, eof: true });
      const end = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt'), offset: 5000 }).set(as(OWNER)).expect(200);
      expect(end.body).toMatchObject({ text: '', length: 0, eof: true });
    });

    it('never splits a multi-byte character across windows', async () => {
      // notes.txt: "line one\nline two " is 18 bytes, then € (3 bytes). Cut inside the euro sign.
      const a = await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt'), length: 20 }).set(as(OWNER)).expect(200);
      expect(a.body.text).toBe('line one\nline two ');
      expect(a.body.length).toBe(18);
      const b = await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt'), offset: 18 }).set(as(OWNER)).expect(200);
      expect(b.body.text).toBe('€\n');
      // A window starting inside the character skips its tail bytes and reports where it really began.
      const c = await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt'), offset: 19 }).set(as(OWNER)).expect(200);
      expect(c.body).toMatchObject({ text: '\n', offset: 21, length: 1 });
    });

    it('refuses an offset past the end with FILE_RANGE_INVALID', async () => {
      const res = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt'), offset: 5001 }).set(as(OWNER)).expect(400);
      expect(res.body.code).toBe('FILE_RANGE_INVALID');
    });

    it('refuses a binary file (NUL byte) and invalid UTF-8 with FILE_IS_BINARY', async () => {
      const nul = await http().get(`${base()}/content`).query({ path: join(root, 'blob.bin') }).set(as(OWNER)).expect(415);
      expect(nul.body.code).toBe('FILE_IS_BINARY');
      const latin = await http().get(`${base()}/content`).query({ path: join(root, 'latin1.txt') }).set(as(OWNER)).expect(415);
      expect(latin.body.code).toBe('FILE_IS_BINARY');
    });

    it('decides binary from the head of the file even when the window is later', async () => {
      const res = await http().get(`${base()}/content`).query({ path: join(root, 'blob.bin'), offset: 4 }).set(as(OWNER)).expect(415);
      expect(res.body.code).toBe('FILE_IS_BINARY');
    });

    it('refuses a file above the paged cap with FILE_TOO_LARGE, and clamps a window to the full-view cap', async () => {
      settings.fullViewMaxBytes = 1000;
      settings.pagedViewMaxBytes = 4000;
      const large = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt') }).set(as(OWNER)).expect(413);
      expect(large.body.code).toBe('FILE_TOO_LARGE');
      settings.pagedViewMaxBytes = 200 * 1024 * 1024;
      const clamp = await http().get(`${base()}/content`).query({ path: join(root, 'big.txt'), length: 4000 }).set(as(OWNER)).expect(200);
      expect(clamp.body.length).toBe(1000);
    });

    it('refuses a directory with FILE_NOT_A_FILE', async () => {
      const res = await http().get(`${base()}/content`).query({ path: join(root, 'logs') }).set(as(OWNER)).expect(400);
      expect(res.body.code).toBe('FILE_NOT_A_FILE');
    });

    it('reads a file whose name holds shell metacharacters as plain data', async () => {
      const res = await http().get(`${base()}/content`).query({ path: join(root, 'sp ace;$(id).txt') }).set(as(OWNER)).expect(200);
      expect(res.body.text).toBe('odd name');
    });

    it('rate limits content reads per user with 429', async () => {
      settings.contentRequestsPerMinute = 2;
      await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt') }).set(as(OWNER)).expect(200);
      await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt') }).set(as(OWNER)).expect(200);
      const res = await http().get(`${base()}/content`).query({ path: join(root, 'notes.txt') }).set(as(OWNER)).expect(429);
      expect(res.body.code).toBe('FILES_RATE_LIMITED');
    });
  });

  describe('access', () => {
    it.each([
      ['list', () => http().get(base())],
      ['stat', () => http().get(`${base()}/stat`).query({ path: '~' })],
      ['content', () => http().get(`${base()}/content`).query({ path: 'notes.txt' })],
      ['download-token', () => http().post(`${base()}/download-token`).send({ path: 'notes.txt' })],
    ])('answers 404 on %s for a user who cannot connect to the profile, and opens no connection', async (_name, call) => {
      const before = server.stats.connections;
      await call().set(as(OTHER)).expect(404);
      expect(server.stats.connections).toBe(before);
    });
  });

  describe('SFTP disabled', () => {
    it('answers SFTP_UNAVAILABLE, not a fallback to exec', async () => {
      const off = await startSftpTestServer({ root, sftpEnabled: false });
      try {
        const previous = server;
        server = off;
        // The profile double reads `server` lazily, so a fresh app per case points at the disabled one.
        await app.close();
        await buildApp();
        const res = await http().get(base()).set(as(OWNER)).expect(502);
        expect(res.body.code).toBe('SFTP_UNAVAILABLE');
        server = previous;
      } finally {
        await off.close();
      }
    });
  });

  describe('downloads', () => {
    const token = async (path: string) => {
      const res = await http().post(`${base()}/download-token`).set(as(OWNER)).send({ path }).expect(200);
      return res.body as { token: string; expiresAt: string };
    };

    it('streams the exact bytes with Content-Length and Content-Disposition, and audits it', async () => {
      const payload = Buffer.alloc(300_000, 0x61);
      writeFileSync(join(root, 'dl.bin'), payload);
      const { token: t, expiresAt } = await token(join(root, 'dl.bin'));
      expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);

      const res = await http().get(`/files/download/${t}`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).length).toBe(payload.length);
      expect(Buffer.compare(res.body as Buffer, payload)).toBe(0);
      expect(res.headers['content-length']).toBe(String(payload.length));
      expect(res.headers['content-disposition']).toBe("attachment; filename*=UTF-8''dl.bin");
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'server_profile.file_download',
          actorUserId: OWNER,
          targetId: PROFILE,
          meta: expect.objectContaining({ path: join(root, 'dl.bin'), size: payload.length }),
        }),
      );
    });

    it('encodes a hostile file name in Content-Disposition', async () => {
      const { token: t } = await token(join(root, 'sp ace;$(id).txt'));
      const res = await http().get(`/files/download/${t}`).expect(200);
      expect(res.headers['content-disposition']).toBe("attachment; filename*=UTF-8''sp%20ace%3B%24%28id%29.txt");
    });

    it('is single use', async () => {
      const { token: t } = await token(join(root, 'notes.txt'));
      await http().get(`/files/download/${t}`).expect(200);
      const again = await http().get(`/files/download/${t}`).expect(404);
      expect(again.body.code).toBe('FILE_DOWNLOAD_NOT_FOUND');
    });

    it('expires after 60 seconds', async () => {
      const { token: t } = await token(join(root, 'notes.txt'));
      const real = Date.now;
      tokens.now = () => real() + 61_000;
      await http().get(`/files/download/${t}`).expect(404);
    });

    it('is public: no principal is needed, and an unknown token is a 404', async () => {
      await http().get('/files/download/not-a-token').expect(404);
    });

    it('re-checks access on redemption: a revoked connect right is the same 404', async () => {
      const { token: t } = await token(join(root, 'notes.txt'));
      // Re-point the token at a user who lost access.
      const grant = tokens.consume(t)!;
      const revoked = tokens.issue({ ...grant, userId: OTHER });
      await http().get(`/files/download/${revoked.token}`).expect(404);
    });

    it('refuses above the download cap at issue time, and a changed size at redemption', async () => {
      settings.downloadMaxBytes = 1024 * 1024;
      writeFileSync(join(root, 'huge.bin'), Buffer.alloc(1024 * 1024 + 1));
      const big = await http().post(`${base()}/download-token`).set(as(OWNER)).send({ path: join(root, 'huge.bin') }).expect(413);
      expect(big.body.code).toBe('FILE_TOO_LARGE');
      settings.downloadMaxBytes = 2 * 1024 * 1024 * 1024;

      writeFileSync(join(root, 'grow.txt'), 'abc');
      const { token: t } = await token(join(root, 'grow.txt'));
      writeFileSync(join(root, 'grow.txt'), 'abcdef');
      const res = await http().get(`/files/download/${t}`).expect(409);
      expect(res.body.code).toBe('FILE_CHANGED');
    });

    it('refuses a directory and a missing file when issuing', async () => {
      await http().post(`${base()}/download-token`).set(as(OWNER)).send({ path: join(root, 'logs') }).expect(400);
      await http().post(`${base()}/download-token`).set(as(OWNER)).send({ path: join(root, 'nope') }).expect(404);
    });

    it('rate limits tokens per user', async () => {
      settings.downloadsPerMinute = 1;
      await token(join(root, 'notes.txt'));
      const res = await http().post(`${base()}/download-token`).set(as(OWNER)).send({ path: join(root, 'notes.txt') }).expect(429);
      expect(res.body.code).toBe('FILES_RATE_LIMITED');
    });

    it('limits concurrent streams per user', async () => {
      settings.maxConcurrentDownloads = 1;
      limiter.acquireStream(OWNER, 1); // a stream already open
      const { token: t } = await token(join(root, 'notes.txt'));
      const res = await http().get(`/files/download/${t}`).expect(429);
      expect(res.body.code).toBe('FILES_RATE_LIMITED');
    });

    it('stops the SFTP stream and closes the handle when the client aborts', async () => {
      writeFileSync(join(root, 'slow.bin'), Buffer.alloc(8 * 1024 * 1024, 0x62));
      server.readDelayMs = 20;
      const { token: t } = await token(join(root, 'slow.bin'));
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as { port: number }).port;
      const before = server.stats.bytesRead;
      await new Promise<void>((done) => {
        const req = require('node:http').get({ host: '127.0.0.1', port, path: `/files/download/${t}` }, (res: any) => {
          res.once('data', () => {
            req.destroy();
            done();
          });
        });
        req.on('error', () => undefined);
      });
      await new Promise((r) => setTimeout(r, 400));
      const afterAbort = server.stats.bytesRead;
      await new Promise((r) => setTimeout(r, 300));
      expect(server.stats.bytesRead).toBe(afterAbort);
      expect(afterAbort - before).toBeLessThan(8 * 1024 * 1024);
      expect(server.stats.openHandles).toBe(0);
    });
  });

});
