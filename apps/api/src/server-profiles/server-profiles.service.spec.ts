import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ServerProfilesService } from './server-profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { HostKeyError } from '../ssh/host-key.error';
import { ServerFactsService } from '../ssh/server-facts.service';
import { SshConnectionFactory } from '../ssh/ssh-connection.factory';

describe('ServerProfilesService', () => {
  let service: ServerProfilesService;
  let prisma: PrismaService;

  const mockUserId = 'user-123';
  const mockOrgId = 'org-default';
  const mockScope = { userId: mockUserId, orgId: mockOrgId };
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

  const mockProfile = {
    id: mockProfileId,
    userId: mockUserId,
    orgId: mockOrgId,
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
          },
        },
      ],
    }).compile();

    service = module.get<ServerProfilesService>(ServerProfilesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results for the correct user', async () => {
      const profiles = [mockProfile];
      (prisma.serverProfile.findMany as jest.Mock).mockResolvedValue(profiles);
      (prisma.serverProfile.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll(mockScope, {
        page: 1,
        pageSize: 20,
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId, orgId: mockOrgId },
          skip: 0,
          take: 20,
          orderBy: { updatedAt: 'desc' },
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

      await service.findAll(mockScope, {
        page: 1,
        pageSize: 20,
        search: 'prod',
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: mockUserId,
            orgId: mockOrgId,
            OR: [
              { name: { contains: 'prod', mode: 'insensitive' } },
              { hostname: { contains: 'prod', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should calculate pagination correctly', async () => {
      (prisma.serverProfile.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serverProfile.count as jest.Mock).mockResolvedValue(45);

      const result = await service.findAll(mockScope, {
        page: 2,
        pageSize: 20,
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

      const result = await service.findOne(mockProfileId, mockScope);

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId, orgId: mockOrgId },
      });
      expect(result.id).toBe(mockProfileId);
      expect(result.name).toBe('My Server');
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', mockScope),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for wrong user', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne(mockProfileId, { ...mockScope, userId: 'other-user' }),
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

      const result = await service.create(mockScope, { ...base, authMethod: 'password', password: 'my-pass' });

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

      const result = await service.create(mockScope, {
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

      await service.create(mockScope, { ...base, authMethod: 'agent' });

      expect(credentials.setSecret).not.toHaveBeenCalled();
    });

    it('removes the profile when its secret cannot be stored, so none claims a secret it lacks', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);
      credentials.setSecret.mockRejectedValueOnce(new Error('store down'));

      await expect(
        service.create(mockScope, { ...base, authMethod: 'password', password: 'my-pass' }),
      ).rejects.toThrow('store down');

      expect(prisma.serverProfile.delete).toHaveBeenCalledWith({ where: { id: mockProfileId } });
    });
  });

  describe('update', () => {
    it('stores a new credential in the credential store', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);
      stored('password');

      await service.update(mockProfileId, mockScope, { password: 'new-pass' });

      expect(credentials.setSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'), 'new-pass');
      const data = (prisma.serverProfile.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty('encryptedPassword');
    });

    it('removes the credential when it is cleared', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.update(mockProfileId, mockScope, { password: '' });

      expect(credentials.deleteSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'));
      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(result.hasPassword).toBe(false);
    });

    it('keeps every stored secret when the update does not name one', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(mockProfile);

      await service.update(mockProfileId, mockScope, { name: 'Renamed' });

      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(credentials.deleteSecret).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update(mockProfileId, mockScope, { name: 'New Name' }),
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

      await service.remove(mockProfileId, mockScope);

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId, orgId: mockOrgId },
      });
      expect(prisma.serverProfile.delete).toHaveBeenCalledWith({
        where: { id: mockProfileId },
      });
    });

    it('removes the three stored secrets of the profile', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.serverProfile.delete as jest.Mock).mockResolvedValue(mockProfile);

      await service.remove(mockProfileId, mockScope);

      expect(credentials.deleteSecret.mock.calls.map(([, , name]) => name).sort()).toEqual(
        [nameOf('passphrase'), nameOf('password'), nameOf('private_key')].sort(),
      );
      expect(credentials.deleteSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'));
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.remove(mockProfileId, { ...mockScope, userId: 'wrong-user' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toResponse', () => {
    it('reports which secrets the credential store holds, never the legacy columns', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.findOne(mockProfileId, mockScope);

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

      const result = await service.findOne(mockProfileId, mockScope);

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

      const result = await service.findAll(mockScope, { page: 1, pageSize: 20 });

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

      const result = await service.getDecryptedProfile(mockProfileId, mockScope);

      expect(credentials.getSecret).toHaveBeenCalledWith(mockUserId, 'ssh', nameOf('password'));
      expect(result).toMatchObject({ password: 'my-pass', privateKey: null, passphrase: null });
    });

    it('does not read the legacy ciphertext columns', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.getDecryptedProfile(mockProfileId, mockScope);

      expect(result.password).toBeNull();
      expect(JSON.stringify(result)).not.toContain('legacy-ciphertext');
    });

    it('throws NotFoundException for a profile of another owner or organization', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getDecryptedProfile(mockProfileId, mockScope)).rejects.toThrow(NotFoundException);
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });
  });

  describe('organization scope and audit', () => {
    const otherOrg = { userId: mockUserId, orgId: 'org-other' };

    it('names the organization next to the owner in every lookup (another organization is a 404)', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(mockProfileId, otherOrg)).rejects.toThrow(NotFoundException);

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId, orgId: 'org-other' },
      });
    });

    it('audits a creation with the hostname only, never a credential', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);

      await service.create(mockScope, {
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

      await service.update(mockProfileId, mockScope, { name: 'Renamed' });
      await service.remove(mockProfileId, mockScope);

      const actions = auditSink.record.mock.calls.map(([event]) => event.action);
      expect(actions).toEqual(['server_profile.update', 'server_profile.delete']);
    });

    it('does not fail the action when the audit sink fails', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(mockProfile);
      auditSink.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.create(mockScope, {
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

      const result = await service.scanHostKey(mockProfileId, mockScope);

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
      await expect(service.scanHostKey(mockProfileId, mockScope)).resolves.toMatchObject({ trusted: null, matches: false });
    });

    it('answers 502 SSH_HOST_UNREACHABLE when the server cannot be reached', async () => {
      find(untrusted);
      ssh.scan.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await expect(service.scanHostKey(mockProfileId, mockScope)).rejects.toMatchObject({
        response: { code: 'SSH_HOST_UNREACHABLE' },
      });
    });

    it('trusts the confirmed key, records who and when, audits once and probes the facts', async () => {
      find(untrusted);
      ssh.scan.mockResolvedValue(presentedA);

      await service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_A });

      expect(prisma.serverProfile.updateMany).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId, orgId: mockOrgId },
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

      const failure = service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_A });

      await expect(failure).rejects.toBeInstanceOf(ConflictException);
      await expect(failure).rejects.toMatchObject({ response: { code: 'HOST_KEY_CHANGED_DURING_TRUST' } });
      expect(prisma.serverProfile.updateMany).not.toHaveBeenCalled();
      expect(auditSink.record).not.toHaveBeenCalled();
    });

    it('answers 400 when replacing a different key without the typed hostname, before any network', async () => {
      find(trusted);

      const failure = service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_B });

      await expect(failure).rejects.toBeInstanceOf(BadRequestException);
      await expect(failure).rejects.toMatchObject({ response: { code: 'HOST_KEY_CONFIRMATION_REQUIRED' } });
      await expect(
        service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_B, confirmHostname: 'wrong.example.test' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ssh.scan).not.toHaveBeenCalled();
      expect(prisma.serverProfile.updateMany).not.toHaveBeenCalled();
    });

    it('replaces a different key with the typed hostname and audits old and new fingerprints', async () => {
      find(trusted);
      ssh.scan.mockResolvedValue({ fingerprint: FP_B, algorithm: 'ssh-ed25519' });

      await service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_B, confirmHostname: 'example.com' });

      expect(actions()).toEqual(['server_profile.host_key_replaced']);
      expect(auditSink.record).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ oldFingerprint: FP_A, newFingerprint: FP_B }),
        }),
      );
    });

    it('still succeeds when the facts probe after trust fails', async () => {
      find(untrusted);
      ssh.scan.mockResolvedValue(presentedA);
      facts.probe.mockRejectedValue(new Error('auth failed'));
      await expect(service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_A })).resolves.toBeDefined();
    });

    it('forgets the key and the facts audited once; the next connect prompts again', async () => {
      find(trusted);

      await service.forgetHostKey(mockProfileId, mockScope);

      expect(prisma.serverProfile.updateMany).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId, orgId: mockOrgId },
        data: { fingerprint: null, hostKeyAlgorithm: null, hostKeyTrustedAt: null, hostKeyTrustedBy: null },
      });
      expect(actions()).toEqual(['server_profile.host_key_forgotten']);
    });

    it('answers 404 for a profile of another owner on every host-key route', async () => {
      find(null);
      await expect(service.scanHostKey(mockProfileId, mockScope)).rejects.toThrow(NotFoundException);
      await expect(service.trustHostKey(mockProfileId, mockScope, { fingerprint: FP_A })).rejects.toThrow(NotFoundException);
      await expect(service.forgetHostKey(mockProfileId, mockScope)).rejects.toThrow(NotFoundException);
    });

    it('clears the trust and the facts when the hostname changes', async () => {
      find(trusted);
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue(untrusted);

      await service.update(mockProfileId, mockScope, { hostname: 'other.example.test' });

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

      await service.update(mockProfileId, mockScope, { port: 2222 });
      expect((prisma.serverProfile.update as jest.Mock).mock.calls[0][0].data).toMatchObject({ fingerprint: null });

      await service.update(mockProfileId, mockScope, { hostname: 'example.com', port: 22, name: 'Renamed' });
      expect((prisma.serverProfile.update as jest.Mock).mock.calls[1][0].data).not.toHaveProperty('fingerprint');
    });

    it('returns the trust fields and the facts in a profile response', async () => {
      find({ ...trusted, facts: { kernel: 'Linux 6 x86_64', os: 'linux', has: ['tmux'] }, factsProbedAt: new Date('2026-01-02') });

      await expect(service.findOne(mockProfileId, mockScope)).resolves.toMatchObject({
        fingerprint: FP_A,
        hostKeyAlgorithm: 'ssh-ed25519',
        hostKeyTrustedAt: trusted.hostKeyTrustedAt,
        facts: { os: 'linux', has: ['tmux'] },
        factsProbedAt: new Date('2026-01-02'),
      });
    });

    it('reports an untrusted profile with null trust fields and no facts', async () => {
      find(untrusted);
      await expect(service.findOne(mockProfileId, mockScope)).resolves.toMatchObject({
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

      await expect(service.testConnection(mockProfileId, mockScope)).resolves.toEqual({ success: true });

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

      const result = await service.testConnection(mockProfileId, mockScope);

      expect(result).toEqual({ success: false, error: expect.any(String), code, presented, expected: expected ?? null });
      expect(auditSink.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'server_profile.test', meta: { hostname: 'example.com', success: false, code } }),
      );
    });

    it('reports any other failure as an error message without a code', async () => {
      find(row);
      ssh.open.mockRejectedValue(new Error('All configured authentication methods failed'));
      await expect(service.testConnection(mockProfileId, mockScope)).resolves.toEqual({
        success: false,
        error: 'All configured authentication methods failed',
      });
    });

    it('forces a probe on refresh', async () => {
      find(row);
      const probed = { kernel: 'Linux 6 x86_64', os: 'linux', has: ['tmux'] };
      facts.probe.mockResolvedValue(probed);
      await expect(service.refreshFacts(mockProfileId, mockScope)).resolves.toMatchObject({ facts: probed });
    });

    it('serves fresh cached facts without connecting, and probes when they are older than the max age', async () => {
      const cached = { kernel: 'Linux 6 x86_64', os: 'linux', has: [] };
      find({ ...row, facts: cached, factsProbedAt: new Date(Date.now() - 60_000) });
      await expect(service.getFacts(mockProfileId, mockScope)).resolves.toEqual(cached);
      expect(facts.probe).not.toHaveBeenCalled();

      find({ ...row, facts: cached, factsProbedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
      facts.probe.mockResolvedValue({ ...cached, kernel: 'Linux 7 x86_64' });
      await expect(service.getFacts(mockProfileId, mockScope)).resolves.toMatchObject({ kernel: 'Linux 7 x86_64' });
      expect(facts.probe).toHaveBeenCalledTimes(1);
    });

    it('falls back to the cached facts when the lazy probe fails', async () => {
      const cached = { kernel: 'Linux 6 x86_64', os: 'linux', has: [] };
      find({ ...row, facts: cached, factsProbedAt: new Date(0) });
      facts.probe.mockRejectedValue(new Error('unreachable'));
      await expect(service.getFacts(mockProfileId, mockScope)).resolves.toEqual(cached);
    });
  });
});
