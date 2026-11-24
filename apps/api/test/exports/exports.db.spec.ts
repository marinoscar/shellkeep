// =============================================================================
// Data export over a real database: no credential leaves the server (issue #68)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database and drives the real routes with
// real users and a REAL credential store. A server profile is saved with a password, a private key and
// a passphrase (their ciphertext sits in `user_credentials`), and the three legacy ciphertext columns of
// the profile are filled with sentinels. The two sources an export reads them through (`server-profiles`
// and the platform's `user-data`) are then run through EVERY writer (json, the csv zip, xlsx):
//
//   - the plaintext secrets, the ciphertext of the credential store and the legacy ciphertext
//     (`SENTINEL_SSH_SECRET`) appear in no byte of any output;
//   - the profile's non-secret data (name, host, fingerprint) is there;
//   - the requester's own rows only; `includeShared` adds a profile another user shared with them, and
//     still never its credentials;
//   - `terminal-sessions` exports metadata (the tmux session name) for the requested range only;
//   - the export file is ready with a signed URL that forces a download; someone else's export is a 404.
//
// Run with `npm run test:db` (as the bootstrap superuser, then as the application role).
// =============================================================================

import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import request from 'supertest';
import { ExportRunHandler, type ExportJobPayload } from '@marinoscar/platform-api/exports';
import { exportFileText } from '@marinoscar/platform-api/exports/testing';
import type { Job } from '@marinoscar/platform-api/jobs';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { createMockStorageProvider, installMockStorageProvider } from '../helpers/mock-storage-provider.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// Obviously fake, assembled at run time so no secret-shaped literal sits in the source. The marker makes
// any leak into an output easy to find.
const SENTINEL_SSH_SECRET = ['SENTINEL', 'SSH', 'SECRET', RUN].join('-');
const PASSWORD = `${SENTINEL_SSH_SECRET}-password`;
const PASSPHRASE = `${SENTINEL_SSH_SECRET}-passphrase`;
const PRIVATE_KEY = [
  ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' '),
  `${SENTINEL_SSH_SECRET}-private-key-body`,
  ['-----END', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' '),
].join('\n');
const LEGACY_CIPHERTEXT = {
  encryptedPassword: `${SENTINEL_SSH_SECRET}-legacy-encrypted-password`,
  encryptedPrivateKey: `${SENTINEL_SSH_SECRET}-legacy-encrypted-private-key`,
  encryptedPassphrase: `${SENTINEL_SSH_SECRET}-legacy-encrypted-passphrase`,
};
const FORMATS = [
  { id: 'json', extension: 'json' },
  { id: 'csv', extension: 'zip' },
  { id: 'xlsx', extension: 'xlsx' },
] as const;

interface Person {
  email: string;
  token: string;
  userId: string;
  orgId: string;
}

describe('Data export (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  const files = new Map<string, Buffer>();
  const signedUrlCalls: Array<{ key: string; options: { expiresIn?: number; responseContentDisposition?: string } }> = [];

  let A: Person;
  let B: Person;
  let ciphertexts: string[] = [];
  let aKeyProfileId: string;
  let aPasswordProfileId: string;
  let bSharedProfileId: string;
  let bPrivateProfileId: string;

  async function login(name: string): Promise<Person> {
    const email = `${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role: 'contributor' }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { org: string };
    return { email, token, userId: me.body.data.id as string, orgId: claims.org };
  }

  /** Queues an export over HTTP and runs the job as a worker would. */
  async function runExport(person: Person, body: { source: string; format: string; request?: object }): Promise<{ id: string; job: Job }> {
    const queued = await request(server()).post('/api/exports').set(bearer(person.token)).send(body).expect(202);
    const id = queued.body.data.id as string;
    const job = (await bypass((tx) => tx.job.findUnique({ where: { id } }))) as Job;
    await context.module.get(ExportRunHandler, { strict: false }).process(job);
    // As the worker settles it: a pending or running export counts against the in-flight cap.
    await bypass((tx) => tx.job.update({ where: { id }, data: { status: 'succeeded', finishedAt: new Date() } }));
    return { id, job };
  }

  /** The text of the file an export wrote (zips decompressed). */
  async function fileTextOf(exportId: string): Promise<string> {
    const row = await bypass((tx) => tx.job.findUnique({ where: { id: exportId } }));
    const result = (row.payload as ExportJobPayload & { result?: { storageObjectId: string } }).result;
    expect(result).toBeDefined();
    const object = await bypass((tx) => tx.storageObject.findUnique({ where: { id: result!.storageObjectId } }));
    const bytes = files.get(object.storageKey as string);
    expect(bytes).toBeDefined();
    return exportFileText(bytes!);
  }

  const createProfile = (person: Person, name: string, extra: Record<string, unknown>) =>
    request(server())
      .post('/api/server-profiles')
      .set(bearer(person.token))
      .send({ name: `${name}-${RUN}`, hostname: `${name}.example.test`, port: 22, username: 'ops', ...extra });

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });

    const storage = createMockStorageProvider();
    storage.upload.mockImplementation(async (key: string, stream: Readable) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const bytes = Buffer.concat(chunks);
      files.set(key, bytes);
      return { key, size: bytes.length, etag: 'etag-export' };
    });
    storage.getSignedDownloadUrl.mockImplementation(async (key: string, options: { expiresIn?: number; responseContentDisposition?: string }) => {
      signedUrlCalls.push({ key, options });
      return `https://storage.example.test/${key}?signed=1`;
    });
    installMockStorageProvider(context, storage);

    [A, B] = [await login('owner'), await login('other')];

    aPasswordProfileId = (await createProfile(A, 'pw', { authMethod: 'password', password: PASSWORD }).expect(201)).body.data.id;
    aKeyProfileId = (
      await createProfile(A, 'key', { authMethod: 'key', privateKey: PRIVATE_KEY, passphrase: PASSPHRASE }).expect(201)
    ).body.data.id;
    bSharedProfileId = (await createProfile(B, 'bshared', { authMethod: 'password', password: PASSWORD }).expect(201)).body.data.id;
    bPrivateProfileId = (await createProfile(B, 'bprivate', { authMethod: 'password', password: PASSWORD }).expect(201)).body.data.id;
    await request(server())
      .post('/api/grants')
      .set(bearer(B.token))
      .send({ resourceType: 'server_profile', resourceId: bSharedProfileId, role: 'viewer', grantee: { kind: 'user', userId: A.userId } })
      .expect(201);

    // The legacy ciphertext columns and a host-key fingerprint, then two sessions a month apart.
    await bypass(async (tx) => {
      await tx.serverProfile.updateMany({
        where: { id: { in: [aPasswordProfileId, aKeyProfileId, bSharedProfileId, bPrivateProfileId] } },
        data: { ...LEGACY_CIPHERTEXT, fingerprint: `SHA256:fingerprint-${RUN}` },
      });
      const base = { userId: A.userId, orgId: A.orgId, serverProfileId: aPasswordProfileId, cols: 100, rows: 30 };
      await tx.terminalSession.create({
        data: { ...base, name: `jan-${RUN}`, tmuxSessionId: `tmux-jan-${RUN}`, status: 'terminated', createdAt: new Date('2026-01-15T12:00:00Z') },
      });
      await tx.terminalSession.create({
        data: { ...base, name: `mar-${RUN}`, tmuxSessionId: `tmux-mar-${RUN}`, status: 'active', createdAt: new Date('2026-03-15T12:00:00Z') },
      });
      await tx.terminalSession.create({
        data: { ...base, userId: B.userId, serverProfileId: bPrivateProfileId, name: `b-session-${RUN}`, tmuxSessionId: `tmux-b-${RUN}`, createdAt: new Date('2026-01-16T12:00:00Z') },
      });
      const rows = await tx.userCredential.findMany({ where: { userId: { in: [A.userId, B.userId] }, purpose: 'ssh' } });
      ciphertexts = rows.map((row: { secret: string }) => row.secret);
    });
  }, 180_000);

  afterAll(async () => {
    // Detached `export.ready` notifications may still be recording; let them finish before the users go.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await bypass(async (tx) => {
      await tx.grant.deleteMany({ where: { orgId: A.orgId, resourceType: 'server_profile' } });
      await tx.terminalSession.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.serverProfile.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  it('has real ciphertext in the credential store to look for (the proof is not vacuous)', () => {
    expect(ciphertexts.length).toBeGreaterThanOrEqual(5);
    for (const secret of ciphertexts) {
      expect(secret.length).toBeGreaterThan(20);
      expect(secret).not.toContain(SENTINEL_SSH_SECRET);
    }
  });

  /** Nothing secret in `text`: not a sentinel, not a plaintext, not one byte of stored ciphertext. */
  function expectNoSecret(text: string): void {
    expect(text).not.toContain(SENTINEL_SSH_SECRET);
    expect(text).not.toContain('PRIVATE KEY');
    for (const ciphertext of ciphertexts) expect(text).not.toContain(ciphertext);
    for (const column of ['encryptedPassword', 'encryptedPrivateKey', 'encryptedPassphrase']) expect(text).not.toContain(column);
  }

  describe.each(FORMATS)('$id', ({ id: format, extension }) => {
    it('server-profiles: the requester’s profiles with their non-secret data and no secret byte', async () => {
      const { id, job } = await runExport(A, { source: 'server-profiles', format });
      const text = await fileTextOf(id);

      expectNoSecret(text);
      expect(text).toContain(`pw-${RUN}`);
      expect(text).toContain(`key-${RUN}`);
      expect(text).toContain(`pw.example.test`);
      expect(text).toContain(`SHA256:fingerprint-${RUN}`);
      // Only A's profiles: B's are neither owned nor shared-and-requested.
      expect(text).not.toContain(`bshared-${RUN}`);
      expect(text).not.toContain(`bprivate-${RUN}`);

      const view = await request(server()).get(`/api/exports/${id}`).set(bearer(A.token)).expect(200);
      expect(view.body.data).toMatchObject({ status: 'ready', source: 'server-profiles', format });
      expect(view.body.data.fileName).toMatch(new RegExp(`^shellkeep-server-profiles-\\d{4}-\\d{2}-\\d{2}\\.${extension}$`));
      const signed = signedUrlCalls[signedUrlCalls.length - 1]!;
      expect(view.body.data.download.url).toContain(signed.key);
      expect(signed.options.expiresIn).toBe(300);
      expect(signed.options.responseContentDisposition).toMatch(/^attachment; filename="/);
      expect(job.type).toBe('export.run');
    }, 60_000);

    it('server-profiles with includeShared: adds the profile shared with the requester, still no secret', async () => {
      const { id } = await runExport(A, { source: 'server-profiles', format, request: { includeShared: true } });
      const text = await fileTextOf(id);

      expectNoSecret(text);
      expect(text).toContain(`bshared-${RUN}`);
      expect(text).toContain('shared');
      expect(text).not.toContain(`bprivate-${RUN}`);
    }, 60_000);

    it('user-data: the requester’s whole record, profiles included, with no secret byte', async () => {
      const { id } = await runExport(A, { source: 'user-data', format });
      const text = await fileTextOf(id);

      expectNoSecret(text);
      expect(text).toContain(`pw-${RUN}`);
      expect(text).toContain(`tmux-jan-${RUN}`);
      expect(text).not.toContain(`b-session-${RUN}`);
      expect(text).not.toContain(`bprivate-${RUN}`);
    }, 60_000);

    it('terminal-sessions: metadata of the requested range only, no secret byte', async () => {
      const { id } = await runExport(A, { source: 'terminal-sessions', format, request: { from: '2026-01-01', to: '2026-01-31' } });
      const text = await fileTextOf(id);

      expectNoSecret(text);
      expect(text).toContain(`tmux-jan-${RUN}`);
      expect(text).not.toContain(`tmux-mar-${RUN}`);
      expect(text).not.toContain(`tmux-b-${RUN}`);
    }, 60_000);
  });

  it('terminal-sessions filters by status', async () => {
    const { id } = await runExport(A, { source: 'terminal-sessions', format: 'json', request: { from: '2026-01-01', to: '2026-12-31', status: 'active' } });
    const text = await fileTextOf(id);
    expect(text).toContain(`tmux-mar-${RUN}`);
    expect(text).not.toContain(`tmux-jan-${RUN}`);
  }, 60_000);

  it('runbook-runs: queued and completed, with an empty file until the run tables exist (#62)', async () => {
    const { id } = await runExport(A, { source: 'runbook-runs', format: 'json', request: { from: '2026-01-01', to: '2026-12-31' } });
    const view = await request(server()).get(`/api/exports/${id}`).set(bearer(A.token)).expect(200);
    expect(view.body.data.status).toBe('ready');
    expectNoSecret(await fileTextOf(id));
  }, 60_000);

  it('answers 404, never 403, for someone else’s export, and lists only the caller’s own', async () => {
    const { id } = await runExport(A, { source: 'server-profiles', format: 'json' });
    await request(server()).get(`/api/exports/${id}`).set(bearer(B.token)).expect(404);
    const mine = await request(server()).get('/api/exports').set(bearer(B.token)).expect(200);
    expect(mine.body.data.items.map((item: { id: string }) => item.id)).not.toContain(id);
    const own = await request(server()).get('/api/exports').set(bearer(A.token)).expect(200);
    expect(own.body.data.items.map((item: { id: string }) => item.id)).toContain(id);
  }, 60_000);

  it('puts export.ready in the requester’s bell, and in nobody else’s', async () => {
    const { id } = await runExport(A, { source: 'server-profiles', format: 'csv' });
    // The slice sends it detached, after the commit: wait for the inbox row.
    type Row = { eventKey: string; title: string; body: string; link: string | null };
    const inbox = async (person: Person): Promise<Row[]> => {
      const res = await request(server()).get('/api/notifications').set(bearer(person.token)).expect(200);
      return (res.body.data.items as Row[]).filter((n) => n.eventKey === 'export.ready');
    };
    let ready: Row[] = [];
    for (let attempt = 0; attempt < 40 && ready.length === 0; attempt += 1) {
      ready = await inbox(A);
      if (ready.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(ready.length).toBeGreaterThanOrEqual(1);
    expect(ready[0]).toMatchObject({ title: 'Your export is ready', link: '/settings/data-export' });
    // The export is B's only if B asked for it: B has none.
    expect(await inbox(B)).toEqual([]);
    void id;
  }, 60_000);

  it('lists the three ShellKeep sources for a contributor', async () => {
    const res = await request(server()).get('/api/exports/sources').set(bearer(A.token)).expect(200);
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(['user-data', 'server-profiles', 'terminal-sessions', 'runbook-runs']),
    );
  });
});
