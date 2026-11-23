import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ServerProfilesService } from './server-profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';

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

  const mockProfile = {
    id: mockProfileId,
    userId: mockUserId,
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
        {
          provide: PrismaService,
          useValue: {
            serverProfile: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
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
});
