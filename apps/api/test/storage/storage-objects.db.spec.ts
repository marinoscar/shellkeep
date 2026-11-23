// =============================================================================
// Storage objects over a real database (issue #50)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database with a
// provider double, and walks the objects API as a Contributor: resumable upload
// (init, complete), simple upload, download URL, delete, and that another user's
// object answers 404. Every `storage_objects` and `storage_object_chunks` access
// goes through the slice's `runInOrg`, so the same spec passes when POSTGRES_USER
// is the ordinary application role (`shellkeep_app`, forced row-level security),
// which is how #50 is verified. Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { ObjectsService } from '@marinoscar/platform-api/storage';

import { createMockStorageProvider, installMockStorageProvider } from '../helpers/mock-storage-provider.helper';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const email = (name: string) => `${name}-${RUN}@example.test`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Storage objects (real database)', () => {
  let context: TestContext;
  let provider: ReturnType<typeof createMockStorageProvider>;
  const createdEmails: string[] = [];
  const server = () => context.app.getHttpServer();

  async function login(name: string, role: 'admin' | 'contributor' | 'viewer') {
    const address = email(name);
    createdEmails.push(address);
    const response = await request(server()).post('/api/auth/test/login').send({ email: address, role }).expect(302);
    const accessToken = new URL(response.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(accessToken)).expect(200);
    return { token: accessToken, userId: me.body.data.id as string, orgId: me.body.data.currentOrgId as string | undefined };
  }

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    provider = createMockStorageProvider();
    installMockStorageProvider(context, provider);
  });

  afterAll(async () => {
    const users = await context.prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    // Cleanup runs with the bypass flag the way a migration does; the application role cannot see other rows.
    await context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.storageObject.deleteMany({ where: { uploadedById: { in: ids } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await closeTestApp(context);
  });

  it('uploads resumably, lists, downloads and deletes as a contributor, under uploads/', async () => {
    const owner = await login('owner', 'contributor');

    const init = await request(server())
      .post('/api/storage/objects/upload/init')
      .set(bearer(owner.token))
      .send({ name: 'notes.pdf', size: 12 * 1024 * 1024, mimeType: 'application/pdf' })
      .expect(201);
    const objectId: string = init.body.data.objectId;
    expect(init.body.data.totalParts).toBe(2);

    const row = await context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.storageObject.findUnique({ where: { id: objectId } });
    });
    expect(row?.storageKey.startsWith('uploads/')).toBe(true);
    expect(row?.uploadedById).toBe(owner.userId);

    await request(server())
      .post(`/api/storage/objects/${objectId}/upload/complete`)
      .set(bearer(owner.token))
      .send({ parts: [{ partNumber: 1, eTag: 'e1' }, { partNumber: 2, eTag: 'e2' }] })
      .expect(201);
    expect(provider.completeMultipartUpload).toHaveBeenCalled();

    const list = await request(server()).get('/api/storage/objects').set(bearer(owner.token)).expect(200);
    expect(list.body.data.items.map((o: { id: string }) => o.id)).toContain(objectId);

    const download = await request(server()).get(`/api/storage/objects/${objectId}/download`).set(bearer(owner.token)).expect(200);
    expect(download.body.data.url).toBe('https://storage.example.test/download');

    await request(server()).delete(`/api/storage/objects/${objectId}`).set(bearer(owner.token)).expect(204);
    expect(provider.delete).toHaveBeenCalledWith(row?.storageKey);
    await request(server()).get(`/api/storage/objects/${objectId}`).set(bearer(owner.token)).expect(404);
  });

  it('stores a simple upload through the slice', async () => {
    const owner = await login('simple', 'contributor');
    const objects = context.module.get(ObjectsService, { strict: false });

    const stored = await objects.simpleUpload(
      { filename: 'avatar-like.png', mimetype: 'image/png', file: Readable.from([Buffer.from('png-bytes')]) },
      owner.userId,
      (await context.prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id,
    );

    expect(stored.name).toBe('avatar-like.png');
    await request(server()).get(`/api/storage/objects/${stored.id}`).set(bearer(owner.token)).expect(200);
  });

  // The slice answers 403 for a colleague's object in the same organization (the object is
  // visible to row-level security but not owned) and 404 for another organization's (invisible
  // to the scoped client). Single-organization mode only exercises the first.
  it("refuses another user's object (403), hides it from their list and leaves it alone", async () => {
    const owner = await login('owner2', 'contributor');
    const other = await login('other', 'contributor');
    const init = await request(server())
      .post('/api/storage/objects/upload/init')
      .set(bearer(owner.token))
      .send({ name: 'private.pdf', size: 6 * 1024 * 1024, mimeType: 'application/pdf' })
      .expect(201);
    const objectId = init.body.data.objectId;

    await request(server()).get(`/api/storage/objects/${objectId}`).set(bearer(other.token)).expect(403);
    await request(server()).get(`/api/storage/objects/${objectId}/download`).set(bearer(other.token)).expect(403);
    await request(server()).delete(`/api/storage/objects/${objectId}`).set(bearer(other.token)).expect(403);
    const list = await request(server()).get('/api/storage/objects').set(bearer(other.token)).expect(200);
    expect(list.body.data.items.map((o: { id: string }) => o.id)).not.toContain(objectId);
    await request(server()).get(`/api/storage/objects/${objectId}`).set(bearer(owner.token)).expect(200);
  });

  it('refuses a viewer the write routes', async () => {
    const viewer = await login('viewer', 'viewer');
    await request(server())
      .post('/api/storage/objects/upload/init')
      .set(bearer(viewer.token))
      .send({ name: 'x.pdf', size: 6 * 1024 * 1024, mimeType: 'application/pdf' })
      .expect(403);
  });
});
