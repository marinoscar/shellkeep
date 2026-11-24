// =============================================================================
// Uploads over the files API against a real ssh2 SFTP server (issue #157)
// =============================================================================
//
// The REAL controller, `FilesService`, `SftpService` and `SshConnectionFactory` over the
// in-process SFTP server serving a temp directory. Only the access decision, the session lookup
// and the settings are doubles. The proofs: bytes and content match, nothing is left behind (no
// temp, no partial file, no open handle) after an overflow or an abort, an existing target is a
// 409 until overwrite, and another user's profile is a 404.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
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
import { FilesPrincipalResolver } from '../../src/files/files-principal.resolver';
import { FilesService } from '../../src/files/files.service';
import { SftpService } from '../../src/files/sftp.service';
import { DEFAULT_FILES_SYSTEM_SETTINGS, type FilesSystemSettings } from '../../src/files/settings/files.system-settings';
import { registerFileUploadBodyParser } from '../../src/files/upload-body-parser';
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
const OCTET = 'application/octet-stream';

describe('file upload over SFTP', () => {
  let root: string;
  let dir: string;
  let server: SftpTestServer;
  let app: NestFastifyApplication;
  let settings: FilesSystemSettings;
  let audit: jest.Mock;

  const as = (userId: string) => ({ 'x-test-user': userId });
  const http = () => request(app.getHttpServer());
  const url = (name: string, extra = '', path = '~/up') =>
    `/server-profiles/${PROFILE}/files/upload?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}${extra}`;
  const upload = (name: string, body: Buffer | string, extra = '', user = OWNER) =>
    http().post(url(name, extra)).set(as(user)).set('Content-Type', OCTET).send(body);
  const leftovers = () => readdirSync(dir);

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    root = mkdtempSync(join(tmpdir(), 'files-upload-'));
    dir = join(root, 'up');
    server = await startSftpTestServer({ root });
  });

  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    settings = { ...DEFAULT_FILES_SYSTEM_SETTINGS, sftpTimeoutSeconds: 10 };
    audit = jest.fn().mockResolvedValue(undefined);
    server.writeDelayMs = 0;
    Object.assign(server.stats, { bytesRead: 0, bytesWritten: 0, writeOpens: 0, connections: 0, sftpRequests: 0 });
    const profile = {
      id: PROFILE,
      userId: OWNER,
      orgId: ORG,
      hostname: '127.0.0.1',
      port: server.port,
      username: server.username,
      authMethod: 'password',
      password: server.password,
      fingerprint: server.fingerprint,
      hostKeyAlgorithm: 'ssh-ed25519',
    };
    const profiles = {
      getDecryptedProfile: jest.fn(async (id: string, principal: { userId: string }) => {
        if (id !== PROFILE || principal.userId !== OWNER) throw new NotFoundException('Server profile not found');
        return profile;
      }),
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
          { provide: FilesPrincipalResolver, useValue: { resolve: jest.fn() } },
          { provide: SessionsService, useValue: { findOne: jest.fn(async () => { throw new NotFoundException('session'); }) } },
          { provide: SessionHistoryService, useValue: { currentPath: jest.fn(async () => null) } },
          { provide: SystemSettingsService, useValue: { getNamespace: jest.fn(async (key: string) => (key === 'files' ? settings : { hostKeyPolicy: 'strict' })) } },
          { provide: AUDIT_SINK, useValue: { record: audit } },
          { provide: PrismaService, useValue: { serverProfile: { updateMany: jest.fn(), findFirst: jest.fn() } } },
        ],
      }),
    ).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const instance = app.getHttpAdapter().getInstance();
    registerFileUploadBodyParser(instance);
    instance.addHook('onRequest', (req: any, _reply: unknown, done: () => void) => {
      const userId = req.headers['x-test-user'];
      if (userId) {
        req.principal = { kind: 'user', userId, email: 'person-a@example.test', credential: 'session', roles: [], permissions: ['sessions:write'], activeOrgId: ORG };
      }
      done();
    });
    await app.init();
    await instance.ready();
  });

  afterEach(async () => {
    // A spec that overflowed a chunked upload leaves its socket open; close() would wait for it.
    app.getHttpServer().closeAllConnections?.();
    await app.close();
  });

  /** A chunked (no Content-Length) upload over a real socket, so a spec can overflow or abort it mid-stream. */
  async function streamUpload(name: string, chunks: Buffer[], options: { abortAfter?: number; gapMs?: number } = {}) {
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    return new Promise<{ status?: number; body?: any; aborted: boolean }>((resolve) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, method: 'POST', path: `/server-profiles/${PROFILE}/files/upload?path=${encodeURIComponent('~/up')}&name=${encodeURIComponent(name)}`, headers: { ...as(OWNER), 'Content-Type': OCTET, 'Transfer-Encoding': 'chunked' } },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => {
            resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined, aborted: false });
            req.destroy();
          });
        },
      );
      req.on('error', () => resolve({ aborted: true }));
      let i = 0;
      const next = (): void => {
        if (options.abortAfter !== undefined && i >= options.abortAfter) {
          req.destroy();
          return void resolve({ aborted: true });
        }
        if (i >= chunks.length) return void req.end();
        req.write(chunks[i++]);
        setTimeout(next, options.gapMs ?? 0);
      };
      next();
    });
  }

  const settled = () => new Promise((r) => setTimeout(r, 500));

  it('streams a file in: the bytes and the content match, no temp is left, and the audit has path, size and hostname only', async () => {
    const data = randomBytes(3 * 1024 * 1024 + 123);
    const res = await upload('data.bin', data).expect(201);
    expect(res.body).toEqual({ path: join(root, 'up', 'data.bin'), name: 'data.bin', size: data.length, overwritten: false });
    expect(readFileSync(join(dir, 'data.bin')).equals(data)).toBe(true);
    expect(leftovers()).toEqual(['data.bin']);
    expect(server.stats.openHandles).toBe(0);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toMatchObject({
      action: 'server_profile.file_upload',
      actorUserId: OWNER,
      targetType: 'server_profile',
      targetId: PROFILE,
      meta: { path: join(root, 'up', 'data.bin'), size: data.length, hostname: '127.0.0.1' },
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(data.subarray(0, 16).toString('latin1'));
  });

  it('accepts an empty file and a name with spaces and shell characters', async () => {
    await upload('empty.txt', Buffer.alloc(0)).expect(201);
    await upload('sp ace;$(id).txt', 'odd').expect(201);
    expect(readFileSync(join(dir, 'empty.txt')).length).toBe(0);
    expect(readFileSync(join(dir, 'sp ace;$(id).txt'), 'utf8')).toBe('odd');
  });

  it('answers 413 FILE_TOO_LARGE from the Content-Length and leaves nothing behind', async () => {
    settings.uploadMaxBytes = 10_000;
    const res = await upload('big.bin', Buffer.alloc(50_000, 1)).expect(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(res.body.details).toMatchObject({ size: 50_000, limit: 10_000 });
    await settled();
    expect(leftovers()).toEqual([]);
    expect(server.stats.writeOpens).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it('counts the bytes while streaming when there is no Content-Length: 413, no file, no temp, no open handle', async () => {
    settings.uploadMaxBytes = 100_000;
    const chunks = Array.from({ length: 10 }, () => Buffer.alloc(30_000, 2));
    const res = await streamUpload('chunked.bin', chunks, { gapMs: 5 });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    await settled();
    expect(leftovers()).toEqual([]);
    expect(server.stats.openHandles).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the cap', async () => {
    settings.uploadMaxBytes = 20_000;
    await upload('edge.bin', Buffer.alloc(20_000, 3)).expect(201);
    expect(readFileSync(join(dir, 'edge.bin')).length).toBe(20_000);
  });

  it('refuses to replace an existing file: 409 FILE_EXISTS with its size and mtime, content untouched', async () => {
    writeFileSync(join(dir, 'a.txt'), 'original');
    const res = await upload('a.txt', 'replacement!').expect(409);
    expect(res.body.code).toBe('FILE_EXISTS');
    expect(res.body.details).toMatchObject({ name: 'a.txt', size: 8 });
    expect(Date.parse(res.body.details.mtime)).not.toBeNaN();
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('original');
    expect(leftovers()).toEqual(['a.txt']);
    expect(audit).not.toHaveBeenCalled();
  });

  it('replaces it with overwrite=true and says so', async () => {
    writeFileSync(join(dir, 'a.txt'), 'original');
    const res = await upload('a.txt', 'replacement!', '&overwrite=true').expect(201);
    expect(res.body).toMatchObject({ name: 'a.txt', size: 12, overwritten: true });
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('replacement!');
    expect(leftovers()).toEqual(['a.txt']);
  });

  it('overwrite=true on a name that does not exist is a plain create', async () => {
    const res = await upload('new.txt', 'x', '&overwrite=true').expect(201);
    expect(res.body.overwritten).toBe(false);
  });

  it('never uploads over a folder', async () => {
    mkdirSync(join(dir, 'folder'));
    const res = await upload('folder', 'x', '&overwrite=true').expect(400);
    expect(res.body.code).toBe('FILE_NOT_A_FILE');
    expect(leftovers()).toEqual(['folder']);
  });

  it.each([
    ['a slash', 'a/b.txt'],
    ['a traversal', '../escape.txt'],
    ['dot dot', '..'],
    ['dot', '.'],
    ['a NUL byte', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['a name over the length limit', 'x'.repeat(201)],
  ])('answers 400 FILE_NAME_INVALID for %s and writes nothing', async (_label, name) => {
    const res = await upload(name, 'x').expect(400);
    expect(res.body.code).toBe('FILE_NAME_INVALID');
    expect(leftovers()).toEqual([]);
    expect(existsSync(join(root, 'escape.txt'))).toBe(false);
    expect(server.stats.writeOpens).toBe(0);
  });

  it('answers 400 when the name is missing', async () => {
    await http().post(`/server-profiles/${PROFILE}/files/upload?path=~/up`).set(as(OWNER)).set('Content-Type', OCTET).send('x').expect(400);
  });

  it('answers 404 for a profile that is not the caller\'s, before looking at the name or the body', async () => {
    await upload('a.txt', 'x', '', OTHER).expect(404);
    await upload('a/b', 'x', '', OTHER).expect(404);
    expect(leftovers()).toEqual([]);
    expect(server.stats.connections).toBe(0);
  });

  it('answers 404 for a target folder that does not exist and 400 for one that is a file', async () => {
    await http().post(url('a.txt', '', '~/nope')).set(as(OWNER)).set('Content-Type', OCTET).send('x').expect(404);
    writeFileSync(join(dir, 'plain'), 'x');
    const res = await http().post(url('a.txt', '', '~/up/plain')).set(as(OWNER)).set('Content-Type', OCTET).send('x').expect(400);
    expect(res.body.code).toBe('FILE_NOT_A_DIRECTORY');
  });

  it('answers 415 for a body that is not application/octet-stream', async () => {
    await http().post(url('a.txt')).set(as(OWNER)).set('Content-Type', 'text/plain').send('x').expect(415);
    expect(leftovers()).toEqual([]);
  });

  it('removes the temp file and the handle when the client aborts mid-stream', async () => {
    server.writeDelayMs = 20;
    const chunks = Array.from({ length: 20 }, () => Buffer.alloc(32 * 1024, 7));
    const res = await streamUpload('abort.bin', chunks, { abortAfter: 6, gapMs: 15 });
    expect(res.aborted).toBe(true);
    await settled();
    await settled();
    expect(leftovers()).toEqual([]);
    expect(server.stats.openHandles).toBe(0);
    expect(server.stats.writeOpens).toBeGreaterThan(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it('frees its concurrency slot after a failure', async () => {
    settings.maxConcurrentDownloads = 1;
    await upload('big.bin', Buffer.alloc(10, 1), '&overwrite=maybe').expect(400);
    await upload('a.txt', 'x').expect(201);
    await upload('a.txt', 'x').expect(409);
    await upload('b.txt', 'x').expect(201);
  });

  it('rate limits per user with the download budget', async () => {
    settings.downloadsPerMinute = 2;
    await upload('a.txt', 'x').expect(201);
    await upload('b.txt', 'x').expect(201);
    const res = await upload('c.txt', 'x').expect(429);
    expect(res.body.code).toBe('FILES_RATE_LIMITED');
  });
});
