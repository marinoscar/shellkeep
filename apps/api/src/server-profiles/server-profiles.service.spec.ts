import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ServerProfilesService } from './server-profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import { AccessPolicy, GrantsService, PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { HostKeyError } from '../ssh/host-key.error';
import { ServerFactsService } from '../ssh/server-facts.service';
import { TerminalWebhooksService } from '../terminal/webhooks/terminal-webhooks.service';
import { SshConnectionFactory } from '../ssh/ssh-connection.factory';

// `runInOrg` is the platform's transaction helper; here it hands the fake client to the callback.
jest.mock('@marinoscar/platform-api/core', () => ({
  ...jest.requireActual('@marinoscar/platform-api/core'),
  runInOrg: (_client: unknown, _scope: unknown, fn: (tx: unknown) => unknown) => fn((global as any).__tx),
}));
// The list filter is the sharing slice's (proven against a real database in test/sharing); here it only returns a where.
jest.mock('../platform/sharing/sharing-access', () => ({
  ...jest.requireActual('../platform/sharing/sharing-access'),
  accessibleListWhere: jest.fn().mockResolvedValue({ userId: 'user-123', ownerGroupId: null }),
}));

describe('ServerProfilesService', () => {
  let service: ServerProfilesService;
  let prisma: PrismaService;

  const mockUserId = 'user-123';
  const mockOrgId = 'org-default';
  const mockScope = { userId: mockUserId, orgId: mockOrgId };
  /** The caller as the identity guard hands it to a controller. */
  const principalOf = (userId = mockUserId, orgId = mockOrgId) =>
    ({
      kind: 'user',
      userId,
      email: 'person-a@example.test',
      credential: 'session',
      roles: [],
      permissions: ['servers:read', 'servers:write', 'servers:delete', 'sessions:write', 'runbooks:run'],
      activeOrgId: orgId,
    }) as any;
  const principal = principalOf();
  const OWNER = { allowed: true, role: 'owner', via: 'owner' };
  // AccessPolicy, as the service uses it. Allowed by default; a test refuses one call to prove it is asked.
  const access = {
    require: jest.fn(),
    requireIn: jest.fn(),
    decideManyIn: jest.fn(),
  };
  const grants = { deleteForResources: jest.fn() };
  const principalGroups = { enrich: jest.fn(), groupRoleFor: jest.fn() };
  const auditSink = { record: jest.fn().mockResolvedValue(undefined) };
  const mockProfileId = '7d1f0a52-3c4e-4b6a-9f21-5e8a1c0d2b34';
  const OTHER_ID = '0b9e6c31-8a2d-4f57-b1c3-9d4e7a6f1c20';

  // The credential store, as the service uses it: set, delete, list (names only), get.
  const credentials = {
    setSecret: jest.fn(),
    deleteSecret: jest.fn(),
    getSecret: jest.fn(),
    list: jest.fn(),
  };
  const nameOf = (field: string, id = mockProfileId) => `profile.${id}.${field}`;
  const stored = (...fields: string[]) =>
    credentials.list.mockResolvedValue(fields.map((field) => ({ purpose: 'ssh', name: nameOf(field) })));

  // The connection factory and the facts probe: the host-key logic of the service is proven here
  // against doubles; the factory itself is proven in `ssh/ssh-connection.factory.spec.ts`.
  const ssh = { open: jest.fn(), scan: jest.fn() };
  const facts = { probe: jest.fn(), tryProbeClient: jest.fn() };
  // The webhook events (#54): raised after the host-key update commits.
  const webhooks = { hostKeyChanged: jest.fn() };

  const mockProfile = {
    id: mockProfileId,
    userId: mockUserId,
    orgId: mockOrgId,
    ownerGroupId: null,
    user: { id: mockUserId, displayName: 'Person A', email: 'person-a@example.test' },
    ownerGroup: null,
    name: 'My Server',
    hostname: 'example.com',
    port: 22,
    username: 'admin',
    authMethod: 'password',
    tags: ['prod'],
    // The legacy ciphertext columns: still on the row, never read (#48).
    encryptedPassword: 'legacy-ciphertext',
    encryptedPrivateKey: null,
    encryptedPassphrase: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
  };

  beforeEach(async () => {
    access.require.mockResolvedValue(OWNER);
    access.requireIn.mockResolvedValue(OWNER);
    access.decideManyIn.mockImplementation(async (_tx: unknown, _p: unknown, _a: string, refs: Array<{ type: string; id: string }>) =>
      new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, OWNER])),
    );
    grants.deleteForResources.mockResolvedValue(0);
    principalGroups.enrich.mockImplementation(async (p: unknown) => p);
    credentials.setSecret.mockResolvedValue(undefined);
    credentials.deleteSecret.mockResolvedValue(undefined);
    credentials.getSecret.mockResolvedValue(null);
    credentials.list.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerProfilesService,
        { provide: AUDIT_SINK, useValue: auditSink },
        { provide: UserCredentialsService, useValue: credentials },
        { provide: SshConnectionFactory, useValue: ssh },
        { provide: ServerFactsService, useValue: facts },
        { provide: TerminalWebhooksService, useValue: webhooks },
        { provide: AccessPolicy, useValue: access },
        { provide: GrantsService, useValue: grants },
        { provide: PrincipalGroupsProvider, useValue: principalGroups },
        {
          provide: PrismaService,
          useValue: {
            serverProfile: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              delete: jest.fn(),
            },
            // The caller's last session per profile (#79): none unless a case says so.
            terminalSession: { groupBy: jest.fn().mockResolvedValue([]) },
          },
        },
      ],
    }).compile();

    service = module.get<ServerProfilesService>(ServerProfilesService);
    prisma = module.get<PrismaService>(PrismaService);
    (global as any).__tx = prisma;
    // A created, updated or deleted profile is read back as the caller sees it.
    (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results for the correct user', async () => {
      const profiles = [mockProfile];
      (prisma.serverProfile.findMany as jest.Mock).mockResolvedValue(profiles);
      (prisma.serverProfile.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll(principal, {
        page: 1,
        pageSize: 20,
        filter: 'all',
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // What `accessibleListWhere` selected (here: the caller's own profiles).
          where: { AND: [{ userId: mockUserId, ownerGroupId: null }] },
          skip: 0,
          take: 20,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should apply search filter when provided', async () => {
      (prisma.serverProfile.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serverProfile.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(principal, {
        page: 1,
        pageSize: 20,
        search: 'prod',
        filter: 'all',
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { userId: mockUserId, ownerGroupId: null },
              {
                OR: [
                  { name: { contains: 'prod', mode: 'insensitive' } },
                  { hostname: { contains: 'prod', mode: 'insensitive' } },
                  { username: { contains: 'prod', mode: 'insensitive' } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('should calculate pagination correctly', async () => {
      (prisma.serverProfile.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serverProfile.count as jest.Mock).mockResolvedValue(45);

      const result = await service.findAll(principal, {
        page: 2,
        pageSize: 20,
        filter: 'all',
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.totalPages).toBe(3);
    });
  });

  describe('findOne', () => {
    it('should return the profile for the correct user', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(
        mockProfile,
      );

      const result = await service.findOne(mockProfileId, principal);

      expect(access.requireIn).toHaveBeenCalledWith(expect.anything(), principal, 'read', { type: 'server_profile', id: mockProfileId });
      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockProfileId, orgId: mockOrgId } }),
      );
      expect(result.id).toBe(mockProfileId);
      expect(result.name).toBe('My Server');
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', principal),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for wrong user', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne(mockProfileId, { ...principal, userId: 'other-user' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const base = {
      name: 'My Server',
      hostname: 'example.com',
      port: 22,
      username: 'admin',
      tags: [],
      color: 'default' as const,
    };

    it('stores the password in the credential store, not on the profile row', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);
      stored('password');

      const result = await service.create(principal, { ...base, authMethod: 'password', password: 'my-pass' });

      expect(credentials.setSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'), 'my-pass');
      const data = (prisma.serverProfile.create as jest.Mock).mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ userId: mockUserId, orgId: 'org-default' }));
      expect(data).not.toHaveProperty('encryptedPassword');
      expect(data).not.toHaveProperty('encryptedPrivateKey');
      expect(data).not.toHaveProperty('encryptedPassphrase');
      expect(result.hasPassword).toBe(true);
    });

    it('stores the private key and the passphrase under their own names', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue({ ...mockProfile, authMethod: 'key' });
      stored('private_key', 'passphrase');

      const result = await service.create(principal, {
        ...base,
        authMethod: 'key',
        privateKey: 'my-key',
        passphrase: 'my-phrase',
      });

      expect(credentials.setSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('private_key'), 'my-key');
      expect(credentials.setSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('passphrase'), 'my-phrase');
      expect(credentials.setSecret).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ hasPassword: false, hasPrivateKey: true, hasPassphrase: true });
    });

    it('stores nothing for the fields that are not provided', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue({ ...mockProfile, authMethod: 'agent' });

      await service.create(principal, { ...base, authMethod: 'agent' });

      expect(credentials.setSecret).not.toHaveBeenCalled();
    });

    it('removes the profile when its secret cannot be stored, so none claims a secret it lacks', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);
      credentials.setSecret.mockRejectedValueOnce(new Error('store down'));

      await expect(
        service.create(principal, { ...base, authMethod: 'password', password: 'my-pass' }),
      ).rejects.toThrow('store down');

      expect(prisma.serverProfile.delete).toHaveBeenCalledWith({ where: { id: mockProfileId } });
    });
  });

  describe('update', () => {
    it('stores a new credential in the credential store', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);
      stored('password');

      await service.update(mockProfileId, principal, { password: 'new-pass' });

      expect(credentials.setSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'), 'new-pass');
      const data = (prisma.serverProfile.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty('encryptedPassword');
    });

    it('removes the credential when it is cleared', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.update(mockProfileId, principal, { password: '' });

      expect(credentials.deleteSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'));
      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(result.hasPassword).toBe(false);
    });

    it('keeps every stored secret when the update does not name one', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);

      await service.update(mockProfileId, principal, { name: 'Renamed' });

      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(credentials.deleteSecret).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update(mockProfileId, principal, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
      expect(credentials.setSecret).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete profile with owner check', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(
        mockProfile,
      );
      (prisma.serverProfile.delete as jest.Mock).mockResolvedValue(
        mockProfile,
      );

      await service.remove(mockProfileId, principal);

      expect(access.requireIn).toHaveBeenCalledWith(expect.anything(), principal, 'delete', { type: 'server_profile', id: mockProfileId });
      expect(grants.deleteForResources).toHaveBeenCalledWith(expect.anything(), 'server_profile', [mockProfileId]);
      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, orgId: mockOrgId },
      });
      expect(prisma.serverProfile.delete).toHaveBeenCalledWith({
        where: { id: mockProfileId },
      });
    });

    it('removes the three stored secrets of the profile', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.delete as jest.Mock).mockResolvedValue(mockProfile);

      await service.remove(mockProfileId, principal);

      expect(credentials.deleteSecret.mock.calls.map(([, , name]) => name).sort()).toEqual(
        [nameOf('passphrase'), nameOf('password'), nameOf('private_key')].sort(),
      );
      expect(credentials.deleteSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'));
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.remove(mockProfileId, { ...principal, userId: 'wrong-user' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toResponse', () => {
    it('reports which secrets the credential store holds, never the legacy columns', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.findOne(mockProfileId, principal);

      // The row's legacy `encryptedPassword` is ignored: the store holds nothing.
      expect(result.hasPassword).toBe(false);
      expect(result.hasPrivateKey).toBe(false);
      expect(result.hasPassphrase).toBe(false);
      expect(result).not.toHaveProperty('encryptedPassword');
      expect(result).not.toHaveProperty('encryptedPrivateKey');
      expect(result).not.toHaveProperty('encryptedPassphrase');
    });

    it('sets the has* booleans from the stored credentials', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      stored('password', 'private_key', 'passphrase');

      const result = await service.findOne(mockProfileId, principal);

      expect(result).toMatchObject({ hasPassword: true, hasPrivateKey: true, hasPassphrase: true });
      expect(credentials.list).toHaveBeenCalledWith(mockUserId, 'ssh');
    });

    it('lists the stored secrets once for a whole page of profiles', async () => {
      const other = { ...mockProfile, id: OTHER_ID };
      (prisma.serverProfile.findMany as jest.Mock).mockResolvedValue([mockProfile, other]);
      (prisma.serverProfile.count as jest.Mock).mockResolvedValue(2);
      credentials.list.mockResolvedValue([
        { purpose: 'ssh', name: nameOf('password') },
        { purpose: 'ssh', name: nameOf('private_key', OTHER_ID) },
        { purpose: 'ssh', name: 'unrelated-name' },
      ]);

      const result = await service.findAll(principal, { page: 1, pageSize: 20, filter: 'all' });

      expect(credentials.list).toHaveBeenCalledTimes(1);
      expect(result.items.map((item) => [item.hasPassword, item.hasPrivateKey])).toEqual([
        [true, false],
        [false, true],
      ]);
    });
  });

  describe('getDecryptedProfile', () => {
    it('reads each secret from the credential store of the profile owner', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      credentials.getSecret.mockImplementation(async (_user: string, _purpose: string, name: string) =>
        name === nameOf('password') ? 'my-pass' : null,
      );

      const result = await service.getDecryptedProfile(mockProfileId, principal);

      expect(credentials.getSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'));
      expect(result).toMatchObject({ password: 'my-pass', privateKey: null, passphrase: null });
    });

    it('does not read the legacy ciphertext columns', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.getDecryptedProfile(mockProfileId, principal);

      expect(result.password).toBeNull();
      expect(JSON.stringify(result)).not.toContain('legacy-ciphertext');
    });

    it('throws NotFoundException for a profile of another owner or organization', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getDecryptedProfile(mockProfileId, principal)).rejects.toThrow(NotFoundException);
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });
  });

  describe('organization scope and audit', () => {
    const otherOrg = principalOf(mockUserId, 'org-other');

    it('names the organization next to the owner in every lookup (another organization is a 404)', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(mockProfileId, otherOrg)).rejects.toThrow(NotFoundException);

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockProfileId, orgId: 'org-other' } }),
      );
    });

    it('audits a creation with the hostname only, never a credential', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);

      await service.create(principal, {
        name: 'My Server',
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'password',
        password: 'my-pass',
        tags: [],
        color: 'default',
      });

      expect(auditSink.record).toHaveBeenCalledWith({
        action: 'server_profile.create',
        actorUserId: mockUserId,
        targetType: 'server_profile',
        targetId: mockProfileId,
        meta: { hostname: 'example.com' },
      });
      expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain('my-pass');
    });

    it('audits an update and a deletion', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.delete as jest.Mock).mockResolvedValue(mockProfile);

      await service.update(mockProfileId, principal, { name: 'Renamed' });
      await service.remove(mockProfileId, principal);

      const actions = auditSink.record.mock.calls.map(([event]) => event.action);
      expect(actions).toEqual(['server_profile.update', 'server_profile.delete']);
    });

    it('does not fail the action when the audit sink fails', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);
      auditSink.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.create(principal, {
          name: 'My Server',
          hostname: 'example.com',
          port: 22,
          username: 'admin',
          authMethod: 'agent',
          tags: [],
          color: 'default',
        }),
      ).resolves.toMatchObject({ id: mockProfileId });
    });
  });

  describe('host key trust', () => {
    const FP_A = 'SHA256:' + 'A'.repeat(43);
    const FP_B = 'SHA256:' + 'B'.repeat(43);
    const presentedA = { fingerprint: FP_A, algorithm: 'ssh-ed25519' };
    const untrusted = { ...mockProfile, fingerprint: null, hostKeyAlgorithm: null, hostKeyTrustedAt: null };
    const trusted = {
      ...mockProfile,
      fingerprint: FP_A,
      hostKeyAlgorithm: 'ssh-ed25519',
      hostKeyTrustedAt: new Date('2026-01-01'),
    };
    const find = (row: unknown) => (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(row);
    const actions = () => auditSink.record.mock.calls.map(([event]) => event.action);

    beforeEach(() => {
      facts.probe.mockResolvedValue({ kernel: 'Linux 6 x86_64', os: 'linux', has: [] });
    });

    it('scans without storing: reports the presented key, the trusted one and whether they match', async () => {
      find(trusted);
      ssh.scan.mockResolvedValue(presentedA);

      const result = await service.scanHostKey(mockProfileId, principal);

      expect(result).toEqual({
        presented: presentedA,
        trusted: { fingerprint: FP_A, algorithm: 'ssh-ed25519', trustedAt: trusted.hostKeyTrustedAt },
        matches: true,
      });
      expect(ssh.scan).toHaveBeenCalledWith(trusted);
      expect(prisma.serverProfile.updateMany).not.toHaveBeenCalled();
      expect(auditSink.record).not.toHaveBeenCalled();
    });

    it('reports trusted null and matches false for a profile that trusts nothing', async () => {
      find(untrusted);
      ssh.scan.mockResolvedValue(presentedA);
      await expect(service.scanHostKey(mockProfileId, principal)).resolves.toMatchObject({ trusted: null, matches: false });
    });

    it('answers 502 SSH_HOST_UNREACHABLE when the server cannot be reached', async () => {
      find(untrusted);
      ssh.scan.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await expect(service.scanHostKey(mockProfileId, principal)).rejects.toMatchObject({
        response: { code: 'SSH_HOST_UNREACHABLE' },
      });
    });

    it('trusts the confirmed key, records who and when, audits once and probes the facts', async () => {
      find(untrusted);
      ssh.scan.mockResolvedValue(presentedA);

      await service.trustHostKey(mockProfileId, principal, { fingerprint: FP_A });

      expect(prisma.serverProfile.updateMany).toHaveBeenCalledWith({
        where: { id: mockProfileId, orgId: mockOrgId },
        data: {
          fingerprint: FP_A,
          hostKeyAlgorithm: 'ssh-ed25519',
          hostKeyTrustedAt: expect.any(Date),
          hostKeyTrustedBy: mockUserId,
        },
      });
      expect(actions()).toEqual(['server_profile.host_key_trusted']);
      expect(auditSink.record).toHaveBeenCalledWith(
        expect.objectContaining({ meta: { hostname: 'example.com', fingerprint: FP_A, algorithm: 'ssh-ed25519' } }),
      );
      expect(facts.probe).toHaveBeenCalledTimes(1);
    });

    it('answers 409 HOST_KEY_CHANGED_DURING_TRUST and stores nothing when the key is not the confirmed one', async () => {
      find(untrusted);
      ssh.scan.mockResolvedValue({ fingerprint: FP_B, algorithm: 'ssh-ed25519' });

      const failure = service.trustHostKey(mockProfileId, principal, { fingerprint: FP_A });

      await expect(failure).rejects.toBeInstanceOf(ConflictException);
      await expect(failure).rejects.toMatchObject({ response: { code: 'HOST_KEY_CHANGED_DURING_TRUST' } });
      expect(prisma.serverProfile.updateMany).not.toHaveBeenCalled();
      expect(auditSink.record).not.toHaveBeenCalled();
    });

    it('answers 400 when replacing a different key without the typed hostname, before any network', async () => {
      find(trusted);

      const failure = service.trustHostKey(mockProfileId, principal, { fingerprint: FP_B });

      await expect(failure).rejects.toBeInstanceOf(BadRequestException);
      await expect(failure).rejects.toMatchObject({ response: { code: 'HOST_KEY_CONFIRMATION_REQUIRED' } });
      await expect(
        service.trustHostKey(mockProfileId, principal, { fingerprint: FP_B, confirmHostname: 'wrong.example.test' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ssh.scan).not.toHaveBeenCalled();
      expect(prisma.serverProfile.updateMany).not.toHaveBeenCalled();
    });

    it('replaces a different key with the typed hostname and audits old and new fingerprints', async () => {
      find(trusted);
      ssh.scan.mockResolvedValue({ fingerprint: FP_B, algorithm: 'ssh-ed25519' });

      await service.trustHostKey(mockProfileId, principal, { fingerprint: FP_B, confirmHostname: 'example.com' });

      expect(actions()).toEqual(['server_profile.host_key_replaced']);
      expect(auditSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ oldFingerprint: FP_A, newFingerprint: FP_B }),
        }),
      );
    });

    it('raises server_profile.host_key_changed only when a different trusted key is replaced', async () => {
      webhooks.hostKeyChanged.mockClear();
      find(untrusted);
      ssh.scan.mockResolvedValue(presentedA);
      await service.trustHostKey(mockProfileId, principal, { fingerprint: FP_A });
      expect(webhooks.hostKeyChanged).not.toHaveBeenCalled();

      find(trusted);
      ssh.scan.mockResolvedValue({ fingerprint: FP_B, algorithm: 'ssh-ed25519' });
      await service.trustHostKey(mockProfileId, principal, { fingerprint: FP_B, confirmHostname: 'example.com' });
      expect(webhooks.hostKeyChanged).toHaveBeenCalledTimes(1);
      expect(webhooks.hostKeyChanged).toHaveBeenCalledWith(mockScope, {
        serverProfileId: mockProfileId,
        previousFingerprint: FP_A,
        presentedFingerprint: FP_B,
      });
    });

    it('does not raise the event when the confirmation is refused (nothing was replaced)', async () => {
      webhooks.hostKeyChanged.mockClear();
      find(trusted);
      await expect(service.trustHostKey(mockProfileId, principal, { fingerprint: FP_B })).rejects.toThrow();
      expect(webhooks.hostKeyChanged).not.toHaveBeenCalled();
    });

    it('still succeeds when the facts probe after trust fails', async () => {
      find(untrusted);
      ssh.scan.mockResolvedValue(presentedA);
      facts.probe.mockRejectedValue(new Error('auth failed'));
      await expect(service.trustHostKey(mockProfileId, principal, { fingerprint: FP_A })).resolves.toBeDefined();
    });

    it('forgets the key and the facts audited once; the next connect prompts again', async () => {
      find(trusted);

      await service.forgetHostKey(mockProfileId, principal);

      expect(prisma.serverProfile.updateMany).toHaveBeenCalledWith({
        where: { id: mockProfileId, orgId: mockOrgId },
        data: { fingerprint: null, hostKeyAlgorithm: null, hostKeyTrustedAt: null, hostKeyTrustedBy: null },
      });
      expect(actions()).toEqual(['server_profile.host_key_forgotten']);
    });

    it('answers 404 for a profile of another owner on every host-key route', async () => {
      find(null);
      await expect(service.scanHostKey(mockProfileId, principal)).rejects.toThrow(NotFoundException);
      await expect(service.trustHostKey(mockProfileId, principal, { fingerprint: FP_A })).rejects.toThrow(NotFoundException);
      await expect(service.forgetHostKey(mockProfileId, principal)).rejects.toThrow(NotFoundException);
    });

    it('clears the trust and the facts when the hostname changes', async () => {
      find(trusted);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(untrusted);

      await service.update(mockProfileId, principal, { hostname: 'other.example.test' });

      const data = (prisma.serverProfile.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        hostname: 'other.example.test',
        fingerprint: null,
        hostKeyAlgorithm: null,
        hostKeyTrustedAt: null,
        hostKeyTrustedBy: null,
        factsProbedAt: null,
      });
      expect(data).toHaveProperty('facts');
    });

    it('clears the trust when the port changes, and keeps it when hostname and port are unchanged', async () => {
      find(trusted);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(trusted);

      await service.update(mockProfileId, principal, { port: 2222 });
      expect((prisma.serverProfile.update as jest.Mock).mock.calls[0][0].data).toMatchObject({ fingerprint: null });

      await service.update(mockProfileId, principal, { hostname: 'example.com', port: 22, name: 'Renamed' });
      expect((prisma.serverProfile.update as jest.Mock).mock.calls[1][0].data).not.toHaveProperty('fingerprint');
    });

    it('returns the trust fields and the facts in a profile response', async () => {
      find({ ...trusted, facts: { kernel: 'Linux 6 x86_64', os: 'linux', has: ['tmux'] }, factsProbedAt: new Date('2026-01-02') });

      await expect(service.findOne(mockProfileId, principal)).resolves.toMatchObject({
        fingerprint: FP_A,
        hostKeyAlgorithm: 'ssh-ed25519',
        hostKeyTrustedAt: trusted.hostKeyTrustedAt,
        facts: { os: 'linux', has: ['tmux'] },
        factsProbedAt: new Date('2026-01-02'),
      });
    });

    it('reports an untrusted profile with null trust fields and no facts', async () => {
      find(untrusted);
      await expect(service.findOne(mockProfileId, principal)).resolves.toMatchObject({
        fingerprint: null,
        hostKeyAlgorithm: null,
        hostKeyTrustedAt: null,
        facts: null,
        factsProbedAt: null,
      });
    });
  });

  describe('testConnection and facts', () => {
    const FP = 'SHA256:' + 'C'.repeat(43);
    const row = { ...mockProfile, fingerprint: FP, hostKeyAlgorithm: 'ssh-ed25519', facts: null, factsProbedAt: null };
    const find = (value: unknown) => (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(value);

    it('succeeds over the factory (purpose test), probing the facts on the same connection', async () => {
      find(row);
      const client = { end: jest.fn() };
      ssh.open.mockResolvedValue(client);
      facts.tryProbeClient.mockResolvedValue(null);

      await expect(service.testConnection(mockProfileId, principal)).resolves.toEqual({ success: true });

      expect(ssh.open).toHaveBeenCalledWith(expect.objectContaining({ id: mockProfileId, fingerprint: FP }), { purpose: 'test' });
      expect(facts.tryProbeClient).toHaveBeenCalledWith(client, expect.objectContaining({ id: mockProfileId }));
      expect(client.end).toHaveBeenCalled();
    });

    it.each([
      ['HOST_KEY_UNKNOWN', undefined],
      ['HOST_KEY_MISMATCH', FP],
    ] as const)('reports a %s refusal with both fingerprints and audits the code', async (code, expected) => {
      find(row);
      const presented = { fingerprint: 'SHA256:' + 'D'.repeat(43), algorithm: 'ssh-ed25519' };
      ssh.open.mockRejectedValue(new HostKeyError(code, presented, expected, mockProfileId));

      const result = await service.testConnection(mockProfileId, principal);

      expect(result).toEqual({ success: false, error: expect.any(String), code, presented, expected: expected ?? null });
      expect(auditSink.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'server_profile.test', meta: { hostname: 'example.com', success: false, code } }),
      );
    });

    it('reports any other failure as an error message without a code', async () => {
      find(row);
      ssh.open.mockRejectedValue(new Error('All configured authentication methods failed'));
      await expect(service.testConnection(mockProfileId, principal)).resolves.toEqual({
        success: false,
        error: 'All configured authentication methods failed',
      });
    });

    it('forces a probe on refresh', async () => {
      find(row);
      const probed = { kernel: 'Linux 6 x86_64', os: 'linux', has: ['tmux'] };
      facts.probe.mockResolvedValue(probed);
      await expect(service.refreshFacts(mockProfileId, principal)).resolves.toMatchObject({ facts: probed });
    });

    it('serves fresh cached facts without connecting, and probes when they are older than the max age', async () => {
      const cached = { kernel: 'Linux 6 x86_64', os: 'linux', has: [] };
      find({ ...row, facts: cached, factsProbedAt: new Date(Date.now() - 60_000) });
      await expect(service.getFacts(mockProfileId, principal)).resolves.toEqual(cached);
      expect(facts.probe).not.toHaveBeenCalled();

      find({ ...row, facts: cached, factsProbedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
      facts.probe.mockResolvedValue({ ...cached, kernel: 'Linux 7 x86_64' });
      await expect(service.getFacts(mockProfileId, principal)).resolves.toMatchObject({ kernel: 'Linux 7 x86_64' });
      expect(facts.probe).toHaveBeenCalledTimes(1);
    });

    it('falls back to the cached facts when the lazy probe fails', async () => {
      const cached = { kernel: 'Linux 6 x86_64', os: 'linux', has: [] };
      find({ ...row, facts: cached, factsProbedAt: new Date(0) });
      facts.probe.mockRejectedValue(new Error('unreachable'));
      await expect(service.getFacts(mockProfileId, principal)).resolves.toEqual(cached);
    });
  });

  describe('sharing', () => {
    // A profile owned by another user (the credential holder) and shared with the caller.
    const OWNER_ID = 'owner-456';
    const shared = { ...mockProfile, userId: OWNER_ID, user: { id: OWNER_ID, displayName: 'Person B', email: 'person-b@example.test' } };
    const OPERATOR = { allowed: true, role: 'operator', via: 'user_grant' };
    const EDITOR = { allowed: true, role: 'editor', via: 'group_grant' };

    it('never shows a grantee any credential field, only who owns the profile and what they may do', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(shared);
      access.requireIn.mockResolvedValue(OPERATOR);
      stored('password', 'private_key');

      const result = await service.findOne(mockProfileId, principal);

      expect(result).not.toHaveProperty('hasPassword');
      expect(result).not.toHaveProperty('hasPrivateKey');
      expect(result).not.toHaveProperty('hasPassphrase');
      expect(JSON.stringify(result)).not.toMatch(/legacy-ciphertext|"password":|"privateKey":|"passphrase":|"encrypted/i);
      // The holder's credential metadata is not even read for a grantee.
      expect(credentials.list).not.toHaveBeenCalledWith(OWNER_ID, 'ssh');
      expect(result.owner).toEqual({ kind: 'user', id: OWNER_ID, name: 'Person B' });
      expect(result.access).toMatchObject({ role: 'operator', via: 'user_grant', shared: true, credentialHolder: false });
      expect(result.access.can).toEqual({ connect: true, test: true, write: false, share: false, delete: false });
    });

    it('names a group owner, and a profile the caller owns outright is not "shared"', async () => {
      const grouped = { ...mockProfile, ownerGroupId: 'g-1', ownerGroup: { id: 'g-1', name: 'Team Alpha' } };
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(grouped);
      access.requireIn.mockResolvedValue(EDITOR);
      await expect(service.findOne(mockProfileId, principal)).resolves.toMatchObject({
        owner: { kind: 'group', id: 'g-1', name: 'Team Alpha' },
        access: { role: 'editor', shared: true },
      });

      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      access.requireIn.mockResolvedValue(OWNER);
      await expect(service.findOne(mockProfileId, principal)).resolves.toMatchObject({
        owner: { kind: 'user', id: mockUserId },
        access: { role: 'owner', shared: false },
      });
    });

    it('answers 404 for a profile AccessPolicy refuses, before any row is read', async () => {
      access.requireIn.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.findOne(mockProfileId, principal)).rejects.toThrow(NotFoundException);
      expect(prisma.serverProfile.findFirst).not.toHaveBeenCalled();
    });

    it('requires connect to read a credential, and reads it from the credential store of the user who saved it', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(shared);
      access.require.mockResolvedValue(OPERATOR);
      credentials.getSecret.mockImplementation(async (_user: string, _purpose: string, name: string) =>
        name === nameOf('password') ? 'owners-pass' : null,
      );

      const decrypted = await service.getDecryptedProfile(mockProfileId, principal, 'connect');

      expect(access.require).toHaveBeenCalledWith(principal, 'connect', { type: 'server_profile', id: mockProfileId });
      expect(credentials.getSecret).toHaveBeenCalledWith(OWNER_ID, 'ssh', nameOf('password'));
      expect(credentials.getSecret).not.toHaveBeenCalledWith(mockUserId, 'ssh', expect.anything());
      expect(decrypted).toMatchObject({ userId: OWNER_ID, password: 'owners-pass' });
    });

    it('audits using a credential the caller does not own (never the secret), and stays quiet for their own', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(shared);
      credentials.getSecret.mockResolvedValue('owners-pass');

      await service.getDecryptedProfile(mockProfileId, principal, 'history');

      expect(auditSink.record).toHaveBeenCalledWith({
        action: 'server_profile.connect_as_grantee',
        actorUserId: mockUserId,
        targetType: 'server_profile',
        targetId: mockProfileId,
        meta: { ownerUserId: OWNER_ID, ownerGroupId: null, purpose: 'history', hostname: 'example.com', orgId: mockOrgId },
      });
      expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain('owners-pass');

      auditSink.record.mockClear();
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      await service.getDecryptedProfile(mockProfileId, principal, 'connect');
      expect(auditSink.record).not.toHaveBeenCalled();
    });

    it('checks the `test` action, not `connect`, for a connection test', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      ssh.open.mockResolvedValue({ end: jest.fn() });
      await service.testConnection(mockProfileId, principal);
      expect(access.require).toHaveBeenCalledWith(principal, 'test', { type: 'server_profile', id: mockProfileId });
    });

    it('lets an editor change the name but not the connection or the secrets, which only the holder may', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(shared);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(shared);
      access.require.mockResolvedValue(EDITOR);
      access.requireIn.mockResolvedValue(EDITOR);

      await expect(service.update(mockProfileId, principal, { name: 'Renamed', tags: ['x'] })).resolves.toBeDefined();
      expect(access.require).toHaveBeenCalledWith(principal, 'write', { type: 'server_profile', id: mockProfileId });

      // The same connection sent back with a rename (what an edit form does) is not a change.
      await expect(
        service.update(mockProfileId, principal, { name: 'Again', hostname: 'example.com', port: 22, username: 'admin', authMethod: 'password' }),
      ).resolves.toBeDefined();
      (prisma.serverProfile.update as jest.Mock).mockClear();

      for (const change of [{ hostname: 'evil.example.test' }, { port: 2222 }, { username: 'root' }, { authMethod: 'agent' as const }, { password: 'x' }, { privateKey: 'k' }]) {
        await expect(service.update(mockProfileId, principal, change)).rejects.toMatchObject({
          response: { code: 'SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY' },
        });
      }
      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(prisma.serverProfile.update).not.toHaveBeenCalled();
    });

    it('writes a secret change to the credential store of the holder', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);
      await service.update(mockProfileId, principal, { password: 'new' });
      expect(credentials.setSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'), 'new');
    });

    it('refuses to change a profile the caller may only operate', async () => {
      access.require.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.update(mockProfileId, principal, { name: 'x' })).rejects.toThrow(NotFoundException);
      expect(prisma.serverProfile.update).not.toHaveBeenCalled();
    });

    it('removes the holder\'s secrets and the grants when the owner deletes, nothing when AccessPolicy refuses', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(shared);
      await service.remove(mockProfileId, principal);
      expect(credentials.deleteSecret).toHaveBeenCalledWith(OWNER_ID, 'ssh', nameOf('password'));
      expect(grants.deleteForResources).toHaveBeenCalledTimes(1);

      grants.deleteForResources.mockClear();
      (prisma.serverProfile.delete as jest.Mock).mockClear();
      access.requireIn.mockRejectedValue(new NotFoundException('not found'));
      await expect(service.remove(mockProfileId, principal)).rejects.toThrow(NotFoundException);
      expect(prisma.serverProfile.delete).not.toHaveBeenCalled();
      expect(grants.deleteForResources).not.toHaveBeenCalled();
    });

    it('creates a group-owned profile only for an admin or editor of that group', async () => {
      const base = { name: 'Team box', hostname: 'team.example.test', port: 22, username: 'ops', authMethod: 'agent' as const, tags: [], color: 'default' as const };
      principalGroups.groupRoleFor.mockResolvedValueOnce(null);
      await expect(service.create(principal, { ...base, ownerGroupId: 'g-1' })).rejects.toThrow(NotFoundException);
      principalGroups.groupRoleFor.mockResolvedValueOnce('viewer');
      await expect(service.create(principal, { ...base, ownerGroupId: 'g-1' })).rejects.toMatchObject({ response: { code: 'GROUP_ROLE_INSUFFICIENT' } });
      expect(prisma.serverProfile.create).not.toHaveBeenCalled();

      principalGroups.groupRoleFor.mockResolvedValueOnce('editor');
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue({ ...mockProfile, ownerGroupId: 'g-1' });
      await service.create(principal, { ...base, ownerGroupId: 'g-1' });
      expect((prisma.serverProfile.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ ownerGroupId: 'g-1', userId: mockUserId });
    });

    it('reads a credential for a session holder through the same connect check', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(shared);
      access.require.mockRejectedValueOnce(new NotFoundException('not found'));
      await expect(service.getDecryptedProfileForSession(mockProfileId, mockScope, 'history')).rejects.toThrow(NotFoundException);
      expect(credentials.getSecret).not.toHaveBeenCalled();

      access.require.mockResolvedValue(OPERATOR);
      await service.getDecryptedProfileForSession(mockProfileId, mockScope, 'history');
      expect(access.require).toHaveBeenLastCalledWith(expect.objectContaining({ userId: mockUserId, activeOrgId: mockOrgId }), 'connect', {
        type: 'server_profile',
        id: mockProfileId,
      });
    });

    it('asks to connect without reading a credential (assertCanConnect)', async () => {
      await service.assertCanConnect(mockProfileId, principal);
      expect(access.require).toHaveBeenCalledWith(principal, 'connect', { type: 'server_profile', id: mockProfileId });
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });
  });
});
