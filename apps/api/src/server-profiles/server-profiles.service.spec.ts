import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ServerProfilesService } from './server-profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import * as encryptionUtil from '../common/utils/encryption.util';

jest.mock('../common/utils/encryption.util');

const mockedEncrypt = encryptionUtil.encrypt as jest.MockedFunction<
  typeof encryptionUtil.encrypt
>;
const mockedDecrypt = encryptionUtil.decrypt as jest.MockedFunction<
  typeof encryptionUtil.decrypt
>;
const mockedGetEncryptionKey =
  encryptionUtil.getEncryptionKey as jest.MockedFunction<
    typeof encryptionUtil.getEncryptionKey
  >;

describe('ServerProfilesService', () => {
  let service: ServerProfilesService;
  let prisma: PrismaService;

  const mockUserId = 'user-123';
  const mockProfileId = 'profile-456';
  const mockKey = Buffer.alloc(32, 'k');

  const mockProfile = {
    id: mockProfileId,
    userId: mockUserId,
    name: 'My Server',
    hostname: 'example.com',
    port: 22,
    username: 'admin',
    authMethod: 'password',
    tags: ['prod'],
    encryptedPassword: 'enc-password',
    encryptedPrivateKey: null,
    encryptedPassphrase: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
  };

  beforeEach(async () => {
    mockedGetEncryptionKey.mockReturnValue(mockKey);
    mockedEncrypt.mockImplementation((plaintext) => `encrypted:${plaintext}`);
    mockedDecrypt.mockImplementation((encrypted) =>
      encrypted.replace('enc-', ''),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerProfilesService,
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

      const result = await service.findAll(mockUserId, {
        page: 1,
        pageSize: 20,
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId },
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

      await service.findAll(mockUserId, {
        page: 1,
        pageSize: 20,
        search: 'prod',
      });

      expect(prisma.serverProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: mockUserId,
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

      const result = await service.findAll(mockUserId, {
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

      const result = await service.findOne(mockProfileId, mockUserId);

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId },
      });
      expect(result.id).toBe(mockProfileId);
      expect(result.name).toBe('My Server');
    });

    it('should throw NotFoundException when profile does not exist', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', mockUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for wrong user', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne(mockProfileId, 'other-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should encrypt password before storage', async () => {
      const createdProfile = { ...mockProfile, encryptedPassword: 'encrypted:my-pass' };
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue(
        createdProfile,
      );

      await service.create(mockUserId, {
        name: 'My Server',
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'password',
        password: 'my-pass',
        tags: [],
      });

      expect(mockedEncrypt).toHaveBeenCalledWith('my-pass', mockKey);
      expect(prisma.serverProfile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          encryptedPassword: 'encrypted:my-pass',
          userId: mockUserId,
        }),
      });
    });

    it('should encrypt privateKey and passphrase before storage', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue({
        ...mockProfile,
        authMethod: 'key',
        encryptedPassword: null,
        encryptedPrivateKey: 'encrypted:my-key',
        encryptedPassphrase: 'encrypted:my-phrase',
      });

      await service.create(mockUserId, {
        name: 'Key Server',
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'key',
        privateKey: 'my-key',
        passphrase: 'my-phrase',
        tags: [],
      });

      expect(mockedEncrypt).toHaveBeenCalledWith('my-key', mockKey);
      expect(mockedEncrypt).toHaveBeenCalledWith('my-phrase', mockKey);
    });

    it('should not encrypt fields that are not provided', async () => {
      (prisma.serverProfile.create as jest.Mock).mockResolvedValue({
        ...mockProfile,
        authMethod: 'agent',
        encryptedPassword: null,
      });

      await service.create(mockUserId, {
        name: 'Agent Server',
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'agent',
        tags: [],
      });

      expect(mockedEncrypt).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should encrypt new credentials on update', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(
        mockProfile,
      );
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue({
        ...mockProfile,
        encryptedPassword: 'encrypted:new-pass',
      });

      await service.update(mockProfileId, mockUserId, {
        password: 'new-pass',
      });

      expect(mockedEncrypt).toHaveBeenCalledWith('new-pass', mockKey);
      expect(prisma.serverProfile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          encryptedPassword: 'encrypted:new-pass',
        }),
      });
    });

    it('should set encrypted field to null when credential is cleared', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(
        mockProfile,
      );
      (prisma.serverProfile.update as jest.Mock).mockResolvedValue({
        ...mockProfile,
        encryptedPassword: null,
      });

      await service.update(mockProfileId, mockUserId, {
        password: '',
      });

      expect(prisma.serverProfile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          encryptedPassword: null,
        }),
      });
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update(mockProfileId, mockUserId, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
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

      await service.remove(mockProfileId, mockUserId);

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, userId: mockUserId },
      });
      expect(prisma.serverProfile.delete).toHaveBeenCalledWith({
        where: { id: mockProfileId },
      });
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.remove(mockProfileId, 'wrong-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toResponse', () => {
    it('should strip encrypted fields and add has* booleans', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(
        mockProfile,
      );

      const result = await service.findOne(mockProfileId, mockUserId);

      expect(result).not.toHaveProperty('encryptedPassword');
      expect(result).not.toHaveProperty('encryptedPrivateKey');
      expect(result).not.toHaveProperty('encryptedPassphrase');
      expect(result.hasPassword).toBe(true);
      expect(result.hasPrivateKey).toBe(false);
      expect(result.hasPassphrase).toBe(false);
    });

    it('should set has* booleans correctly when all credentials present', async () => {
      const fullProfile = {
        ...mockProfile,
        encryptedPrivateKey: 'enc-key',
        encryptedPassphrase: 'enc-phrase',
      };
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(
        fullProfile,
      );

      const result = await service.findOne(mockProfileId, mockUserId);

      expect(result.hasPassword).toBe(true);
      expect(result.hasPrivateKey).toBe(true);
      expect(result.hasPassphrase).toBe(true);
    });
  });
});
