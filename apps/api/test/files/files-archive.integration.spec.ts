// =============================================================================
// Folder archives: the route, the job and the download over a real ssh2 server (issue #158)
// =============================================================================
//
// The REAL controller, `FileArchivesService`, `FilesService`, `SftpService`, `FileArchiveHandler` and
// `SshConnectionFactory` over the in-process SSH server (SFTP plus `sh -c` exec) serving a temp directory.
// Doubles: the archive table (an in-memory store behind `runInOrg`), the queue, object storage (a fake that
// consumes the stream), the access decision and the notifications. The proofs: the exact tar command with
// hostile names, the bytes landing in storage as a valid tar.gz, the size cap aborting, tar's exit status,
// the lost-access and host-key failures, and a 404 for everyone but the requester.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { Logger, NotFoundException } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, JobsService } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { STORAGE_PROVIDER, registerStorageKeyPrefixes, registerStorageSliceKeyPrefixes, storageKeyPrefixRegistry } from '@marinoscar/platform-api/storage';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';

import { APP_STORAGE_KEY_PREFIXES } from '../../src/app-registrations/storage-prefixes';
import { FileArchiveHandler, archiveObjectKey } from '../../src/files/archive/file-archive.handler';
import { FileArchivesController } from '../../src/files/archive/file-archives.controller';
import { FileArchivesService } from '../../src/files/archive/file-archives.service';
import { FilesPrincipalResolver } from '../../src/files/files-principal.resolver';
import { FilesRateLimiter } from '../../src/files/files-rate-limiter';
import { FilesService } from '../../src/files/files.service';
import { SftpService } from '../../src/files/sftp.service';
import { DownloadTokenStore } from '../../src/files/download-token.store';
import { DEFAULT_FILES_SYSTEM_SETTINGS, type FilesSystemSettings } from '../../src/files/settings/files.system-settings';
import { registerFileErrorCodes } from '../../src/files/files.error-codes';
import { FILES_ARCHIVE_FAILED_EVENT, FILES_ARCHIVE_READY_EVENT } from '../../src/notifications-registry/files.notifications';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ServerProfilesService } from '../../src/server-profiles/server-profiles.service';
import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import { SessionHistoryService } from '../../src/terminal/session-history.service';
import { SessionsService } from '../../src/terminal/sessions.service';
import { withoutAuthGuards } from '../helpers/allow-guards';
import { startSftpTestServer, type SftpTestServer } from './sftp-test-server';

registerFileErrorCodes();
// The key prefixes the app registers at bootstrap (the handler builds its keys with them).
if (!storageKeyPrefixRegistry.has('file-archives')) {
  if (!storageKeyPrefixRegistry.has('uploads')) registerStorageSliceKeyPrefixes();
  registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);
}

const ORG = '11111111-2222-4333-8444-555555555555';
const OWNER = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PROFILE = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';
const NASTY = `we ird 'q' $(touch pwned);\`id\` -rf`;

interface Row {
  id: string;
  orgId: string;
  userId: string;
  serverProfileId: string | null;
  path: string;
  status: string;
  jobId: string | null;
  storageKey: string | null;
  sizeBytes: bigint | null;
  warning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date;
}

describe('folder archives over SSH', () => {
  let root: string;
  let server: SftpTestServer;
  let app: NestFastifyApplication;
  let handler: FileArchiveHandler;
  let rows: Map<string, Row>;
  let objects: Map<string, Buffer>;
  let deleted: string[];
  let enqueued: any[];
  let notify: jest.Mock;
  let audit: jest.Mock;
  let settings: FilesSystemSettings;
  let profileFingerprint: string;
  let canConnect: boolean;
  let principalActive: boolean;
  let signed: any[];
  let storageDown: boolean;

  const as = (userId: string) => ({ 'x-test-user': userId });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    root = mkdtempSync(join(tmpdir(), 'files-archive-'));
    server = await startSftpTestServer({ root, exec: true });
  });

  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const folder = (name = NASTY): string => {
    const dir = join(root, name);
    mkdirSync(join(dir, 'sub dir'), { recursive: true });
    writeFileSync(join(dir, 'a b.txt'), 'hello world');
    writeFileSync(join(dir, `it's.log`), 'x'.repeat(1000));
    writeFileSync(join(dir, 'sub dir', '$(x).txt'), 'nested');
    return dir;
  };

  beforeEach(async () => {
    for (const entry of ['pwned']) rmSync(join(root, entry), { force: true });
    settings = { ...DEFAULT_FILES_SYSTEM_SETTINGS, sftpTimeoutSeconds: 10 };
    rows = new Map();
    objects = new Map();
    deleted = [];
    enqueued = [];
    signed = [];
    notify = jest.fn().mockResolvedValue(undefined);
    audit = jest.fn().mockResolvedValue(undefined);
    profileFingerprint = server.fingerprint;
    canConnect = true;
    principalActive = true;
    storageDown = false;
    server.rewriteExec = null;
    server.execs.length = 0;
    Object.assign(server.stats, { connections: 0, sftpRequests: 0 });

    const tx = {
      $executeRaw: async () => 0,
      fileArchive: {
        create: async ({ data }: any) => {
          const row: Row = {
            id: `00000000-0000-4000-8000-${String(rows.size + 1).padStart(12, '0')}`,
            serverProfileId: null,
            status: 'pending',
            jobId: null,
            storageKey: null,
            sizeBytes: null,
            warning: null,
            errorCode: null,
            errorMessage: null,
            createdAt: new Date(),
            finishedAt: null,
            ...data,
          };
          rows.set(row.id, row);
          return row;
        },
        count: async ({ where }: any) => [...rows.values()].filter((r) => r.userId === where.userId && where.status.in.includes(r.status)).length,
        findFirst: async ({ where }: any) => {
          const row = rows.get(where.id);
          return row && (!where.userId || row.userId === where.userId) ? { ...row } : null;
        },
        update: async ({ where, data }: any) => {
          const row = rows.get(where.id)!;
          Object.assign(row, data);
          return { ...row };
        },
        delete: async ({ where }: any) => void rows.delete(where.id),
      },
    };
    const prisma = {
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      $executeRaw: async () => 0,
      $connect: async () => undefined,
      $extends: () => undefined,
      serverProfile: { updateMany: jest.fn(), findFirst: jest.fn() },
    };

    const profile = () => ({
      id: PROFILE,
      userId: OWNER,
      orgId: ORG,
      name: 'Server A',
      hostname: '127.0.0.1',
      port: server.port,
      username: server.username,
      authMethod: 'password',
      password: server.password,
      fingerprint: profileFingerprint,
      hostKeyAlgorithm: 'ssh-ed25519',
    });
    const profiles = {
      getDecryptedProfile: jest.fn(async (id: string, principal: { userId: string }) => {
        if (id !== PROFILE || principal.userId !== OWNER || !canConnect) throw new NotFoundException('Server profile not found');
        return profile();
      }),
      assertCanConnect: jest.fn(async (id: string, principal: { userId: string }) => {
        if (id !== PROFILE || principal.userId !== OWNER || !canConnect) throw new NotFoundException('Server profile not found');
      }),
    };
    const storage = {
      kind: 's3',
      upload: jest.fn(async (key: string, stream: Readable) => {
        if (storageDown) throw new Error('bucket unavailable');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        objects.set(key, Buffer.concat(chunks));
        return { key };
      }),
      delete: jest.fn(async (key: string) => {
        deleted.push(key);
        objects.delete(key);
      }),
      getSignedDownloadUrl: jest.fn(async (key: string, options: unknown) => {
        signed.push({ key, options });
        return `https://storage.example.test/${key}?sig=1`;
      }),
    };
    const principals = {
      resolve: jest.fn(async (userId: string, orgId: string) =>
        principalActive && userId === OWNER && orgId === ORG
          ? { kind: 'user', userId, activeOrgId: ORG, permissions: ['sessions:write'] }
          : null,
      ),
    };
    const jobs = { enqueue: jest.fn(async (input: any) => (enqueued.push(input), { id: `job-${enqueued.length}` })) };

    const moduleRef = await withoutAuthGuards(
      Test.createTestingModule({
        controllers: [FileArchivesController],
        providers: [
          { provide: APP_PIPE, useClass: ZodValidationPipe },
          FileArchivesService,
          FilesService,
          SftpService,
          SshConnectionFactory,
          DownloadTokenStore,
          FilesRateLimiter,
          JobHandlerRegistry,
          { provide: PrismaService, useValue: prisma },
          { provide: ServerProfilesService, useValue: profiles },
          { provide: FilesPrincipalResolver, useValue: principals },
          { provide: SessionsService, useValue: { findOne: jest.fn(async () => { throw new NotFoundException('session'); }) } },
          { provide: SessionHistoryService, useValue: { currentPath: jest.fn(async () => null) } },
          { provide: SystemSettingsService, useValue: { getNamespace: jest.fn(async (key: string) => (key === 'files' ? settings : { hostKeyPolicy: 'strict' })) } },
          { provide: AUDIT_SINK, useValue: { record: audit } },
          { provide: JobsService, useValue: jobs },
          { provide: STORAGE_PROVIDER, useValue: storage },
          { provide: NotificationsService, useValue: { notify } },
          FileArchiveHandler,
        ],
      }),
    ).compile();
    handler = moduleRef.get(FileArchiveHandler);
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook('onRequest', (req: any, _reply: unknown, done: () => void) => {
      const userId = req.headers['x-test-user'];
      if (userId) {
        req.principal = { kind: 'user', userId, email: 'person-a@example.test', credential: 'session', roles: [], permissions: ['sessions:write'], activeOrgId: ORG };
      }
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const requestArchive = (path: string, user = OWNER) => http().post(`/server-profiles/${PROFILE}/files/archive`).set(as(user)).send({ path });
  const runJob = async () => {
    const input = enqueued[enqueued.length - 1];
    await handler.process({ id: 'job-x', orgId: input.orgId, payload: input.payload } as never);
  };
  const entriesOf = (buffer: Buffer): string[] => {
    const file = join(root, `.check-${randomBytes(4).toString('hex')}.tgz`);
    writeFileSync(file, buffer);
    try {
      return execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
    } finally {
      rmSync(file, { force: true });
    }
  };

  describe('the route', () => {
    it('queues files.archive with ids and the resolved path, and answers 202', async () => {
      const dir = folder();
      const res = await requestArchive(dir);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ archiveId: expect.any(String), jobId: 'job-1', status: 'pending' });
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toMatchObject({
        type: 'files.archive',
        reason: 'files_archive',
        orgId: ORG,
        subjectType: 'file_archive',
        subjectId: res.body.archiveId,
        payload: { archiveId: res.body.archiveId, orgId: ORG, userId: OWNER, serverProfileId: PROFILE, path: dir },
      });
      // No credential or host in the payload.
      expect(JSON.stringify(enqueued[0].payload)).not.toMatch(/password|FAKE-PASSWORD|127\.0\.0\.1/);
      const row = rows.get(res.body.archiveId)!;
      expect(row.status).toBe('pending');
      expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    });

    it('resolves a ~ path to an absolute one before queueing', async () => {
      folder('home-folder');
      const res = await requestArchive('~/home-folder');
      expect(res.status).toBe(202);
      expect(enqueued[0].payload.path).toBe(join(root, 'home-folder'));
    });

    it('refuses a file with FILE_NOT_A_DIRECTORY and queues nothing', async () => {
      writeFileSync(join(root, 'plain.txt'), 'x');
      const res = await requestArchive(join(root, 'plain.txt'));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FILE_NOT_A_DIRECTORY');
      expect(enqueued).toHaveLength(0);
      expect(rows.size).toBe(0);
    });

    it('answers 404 for a server the caller may not connect to', async () => {
      const res = await requestArchive(folder(), OTHER);
      expect(res.status).toBe(404);
      expect(enqueued).toHaveLength(0);
    });

    it('answers 429 when too many archives are already building', async () => {
      settings.maxConcurrentDownloads = 1;
      const dir = folder();
      expect((await requestArchive(dir)).status).toBe(202);
      const second = await requestArchive(dir);
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('FILES_RATE_LIMITED');
      expect(enqueued).toHaveLength(1);
    });

    it('removes the row when the queue is unavailable', async () => {
      const dir = folder();
      const jobs = app.get(JobsService) as unknown as { enqueue: jest.Mock };
      jobs.enqueue.mockRejectedValueOnce(new Error('queue down'));
      const res = await requestArchive(dir);
      expect(res.status).toBe(500);
      expect(rows.size).toBe(0);
    });
  });

  describe('the job', () => {
    it('runs the exact quoted tar command and streams a valid tar.gz into storage', async () => {
      const dir = folder();
      const { body } = await requestArchive(dir);
      await runJob();

      const base = NASTY;
      const quoted = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
      expect(server.execs).toEqual([`tar -czf - -C ${quoted(root)} -- ${quoted(base)}`]);
      expect(existsSync(join(root, 'pwned'))).toBe(false);

      const key = archiveObjectKey(ORG, body.archiveId);
      expect(key).toBe(`file-archives/${ORG}/${body.archiveId}/archive.tar.gz`);
      const stored = objects.get(key)!;
      expect(stored.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
      expect(entriesOf(stored).sort()).toEqual(
        [`${base}/`, `${base}/a b.txt`, `${base}/it's.log`, `${base}/sub dir/`, `${base}/sub dir/$(x).txt`].sort(),
      );

      expect((app.get(STORAGE_PROVIDER) as any).upload).toHaveBeenCalledWith(key, expect.anything(), expect.objectContaining({ metadata: { 'created-at': expect.any(String) } }));
      const row = rows.get(body.archiveId)!;
      expect(row).toMatchObject({ status: 'ready', storageKey: key, warning: null, errorCode: null });
      expect(row.sizeBytes).toBe(BigInt(stored.length));
      expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'server_profile.folder_archive',
          actorUserId: OWNER,
          targetId: PROFILE,
          meta: { path: dir, size: stored.length, hostname: '127.0.0.1' },
        }),
      );
      expect(notify).toHaveBeenCalledWith(FILES_ARCHIVE_READY_EVENT, OWNER, expect.objectContaining({ folderName: base, serverName: 'Server A', sizeBytes: stored.length }));
    });

    it('aborts at the size cap: nothing is left in storage, the row says why', async () => {
      const dir = folder('big');
      writeFileSync(join(dir, 'random.bin'), randomBytes(400 * 1024));
      settings.downloadMaxBytes = 100 * 1024;
      const { body } = await requestArchive(dir);
      await expect(runJob()).rejects.toThrow('ARCHIVE_TOO_LARGE');

      const row = rows.get(body.archiveId)!;
      expect(row).toMatchObject({ status: 'failed', errorCode: 'ARCHIVE_TOO_LARGE' });
      expect(row.errorMessage).toMatch(/larger than the download limit/);
      expect(objects.size).toBe(0);
      expect(deleted).toContain(archiveObjectKey(ORG, body.archiveId));
      expect(notify).toHaveBeenCalledWith(FILES_ARCHIVE_FAILED_EVENT, OWNER, expect.objectContaining({ reason: expect.stringMatching(/download limit/) }));
      expect(audit).not.toHaveBeenCalled();
    });

    it('treats tar exit 1 (a file changed as it was read) as success with a warning', async () => {
      const dir = folder('changing');
      const { body } = await requestArchive(dir);
      server.rewriteExec = (command) => `(${command}); exit 1`;
      await runJob();
      const row = rows.get(body.archiveId)!;
      expect(row.status).toBe('ready');
      expect(row.warning).toMatch(/changed while they were being read/);
      expect(objects.size).toBe(1);
    });

    it('fails on tar exit 2 or more, deletes the object and shows the first stderr line', async () => {
      const dir = folder('vanishing');
      const { body } = await requestArchive(dir);
      rmSync(dir, { recursive: true, force: true });
      await expect(runJob()).rejects.toThrow('ARCHIVE_TAR_FAILED');
      const row = rows.get(body.archiveId)!;
      expect(row.status).toBe('failed');
      expect(row.errorMessage).toMatch(/^tar exited with status 2/);
      expect(objects.size).toBe(0);
      expect(notify).toHaveBeenCalledWith(FILES_ARCHIVE_FAILED_EVENT, OWNER, expect.objectContaining({ reason: expect.stringMatching(/tar exited with status 2/) }));
    });

    it('fails with a non-zero status even though the upload completed', async () => {
      const dir = folder('late-fail');
      const { body } = await requestArchive(dir);
      server.rewriteExec = (command) => `(${command}); exit 3`;
      await expect(runJob()).rejects.toThrow('ARCHIVE_TAR_FAILED');
      expect(rows.get(body.archiveId)!.errorMessage).toMatch(/status 3/);
      expect(objects.size).toBe(0);
      expect(deleted).toHaveLength(1);
    });

    it('fails ARCHIVE_STORAGE_FAILED when the upload is refused', async () => {
      const dir = folder('nostorage');
      const { body } = await requestArchive(dir);
      storageDown = true;
      await expect(runJob()).rejects.toThrow('ARCHIVE_STORAGE_FAILED');
      expect(rows.get(body.archiveId)!.status).toBe('failed');
    });

    it('fails ARCHIVE_TIMEOUT at its own deadline', async () => {
      const dir = folder('slow');
      const { body } = await requestArchive(dir);
      server.rewriteExec = (command) => `sleep 5; ${command}`;
      handler.deadlineMs = 300;
      await expect(runJob()).rejects.toThrow('ARCHIVE_TIMEOUT');
      expect(rows.get(body.archiveId)!.errorCode).toBe('ARCHIVE_TIMEOUT');
    });

    it('fails ARCHIVE_ACCESS_LOST without opening a connection when the requester lost access', async () => {
      const dir = folder('revoked');
      const { body } = await requestArchive(dir);
      Object.assign(server.stats, { connections: 0 });
      canConnect = false;
      await expect(runJob()).rejects.toThrow('ARCHIVE_ACCESS_LOST');
      expect(rows.get(body.archiveId)!.status).toBe('failed');
      expect(server.stats.connections).toBe(0);
      expect(server.execs).toHaveLength(0);
    });

    it('fails ARCHIVE_ACCESS_LOST for a deactivated requester', async () => {
      const { body } = await requestArchive(folder('gone-user'));
      principalActive = false;
      await expect(runJob()).rejects.toThrow('ARCHIVE_ACCESS_LOST');
      expect(rows.get(body.archiveId)!.errorCode).toBe('ARCHIVE_ACCESS_LOST');
    });

    it('fails ARCHIVE_HOST_KEY and runs no command when the host key changed', async () => {
      const { body } = await requestArchive(folder('keys'));
      profileFingerprint = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      await expect(runJob()).rejects.toThrow('ARCHIVE_HOST_KEY');
      expect(rows.get(body.archiveId)!.errorCode).toBe('ARCHIVE_HOST_KEY');
      expect(server.execs).toHaveLength(0);
    });

    it('is a no-op for a ready, failed or purged archive (at-least-once delivery)', async () => {
      const { body } = await requestArchive(folder('twice'));
      await runJob();
      const sizeBefore = rows.get(body.archiveId)!.sizeBytes;
      server.execs.length = 0;
      await runJob();
      expect(server.execs).toHaveLength(0);
      expect(rows.get(body.archiveId)!.sizeBytes).toBe(sizeBefore);
      rows.delete(body.archiveId);
      await expect(runJob()).resolves.toBeUndefined();
    });

    it('is server-only, one attempt, 30 minutes', () => {
      expect(handler).not.toHaveProperty('nodeResultSchema');
      expect(handler).not.toHaveProperty('persistNodeResult');
      expect(handler.profile).toEqual({ maxRuntimeMs: 30 * 60_000, maxAttempts: 1 });
    });
  });

  describe('status and download', () => {
    const ready = async () => {
      const { body } = await requestArchive(folder('ready-one'));
      await runJob();
      return body.archiveId as string;
    };

    it('reports pending, then ready with size and expiry', async () => {
      const { body } = await requestArchive(folder('status'));
      let res = await http().get(`/files/archives/${body.archiveId}`).set(as(OWNER));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ archiveId: body.archiveId, status: 'pending', sizeBytes: null });
      await runJob();
      res = await http().get(`/files/archives/${body.archiveId}`).set(as(OWNER));
      expect(res.body).toMatchObject({ status: 'ready', sizeBytes: expect.any(Number), errorMessage: null });
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    });

    it('reports the failure reason', async () => {
      const dir = folder('fails');
      const { body } = await requestArchive(dir);
      rmSync(dir, { recursive: true, force: true });
      await expect(runJob()).rejects.toThrow();
      const res = await http().get(`/files/archives/${body.archiveId}`).set(as(OWNER));
      expect(res.body).toMatchObject({ status: 'failed', errorCode: 'ARCHIVE_TAR_FAILED' });
    });

    it('answers a signed, short-lived attachment link for a ready archive and audits it', async () => {
      const id = await ready();
      const res = await http().get(`/files/archives/${id}/download`).set(as(OWNER));
      expect(res.status).toBe(200);
      expect(res.body.url).toBe(`https://storage.example.test/file-archives/${ORG}/${id}/archive.tar.gz?sig=1`);
      expect(res.body.filename).toBe('ready-one.tar.gz');
      expect(signed[0].options).toMatchObject({ expiresIn: 900, responseContentDisposition: expect.stringMatching(/^attachment; filename="ready-one\.tar\.gz"/) });
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'server_profile.folder_archive_download', actorUserId: OWNER }));
    });

    it('answers 409 FILE_ARCHIVE_NOT_READY while pending', async () => {
      const { body } = await requestArchive(folder('wait'));
      const res = await http().get(`/files/archives/${body.archiveId}/download`).set(as(OWNER));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('FILE_ARCHIVE_NOT_READY');
    });

    it('answers 404 to another user, for status and download', async () => {
      const id = await ready();
      expect((await http().get(`/files/archives/${id}`).set(as(OTHER))).status).toBe(404);
      expect((await http().get(`/files/archives/${id}/download`).set(as(OTHER))).status).toBe(404);
      expect(signed).toHaveLength(0);
    });

    it('answers 404 to the owner once they may no longer connect to the server', async () => {
      const id = await ready();
      canConnect = false;
      expect((await http().get(`/files/archives/${id}`).set(as(OWNER))).status).toBe(404);
      expect((await http().get(`/files/archives/${id}/download`).set(as(OWNER))).status).toBe(404);
    });

    it('answers 404 for an unknown id and for an archive whose server was deleted', async () => {
      const unknown = '00000000-0000-4000-8000-0000000000ff';
      expect((await http().get(`/files/archives/${unknown}`).set(as(OWNER))).status).toBe(404);
      const id = await ready();
      rows.get(id)!.serverProfileId = null;
      expect((await http().get(`/files/archives/${id}`).set(as(OWNER))).status).toBe(404);
    });

    it('shows expired and refuses the download after 24 hours', async () => {
      const id = await ready();
      rows.get(id)!.expiresAt = new Date(Date.now() - 1000);
      const status = await http().get(`/files/archives/${id}`).set(as(OWNER));
      expect(status.body.status).toBe('expired');
      expect((await http().get(`/files/archives/${id}/download`).set(as(OWNER))).status).toBe(404);
    });
  });
});
