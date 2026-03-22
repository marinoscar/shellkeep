import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';

describe('ServerProfilesController', () => {
  let controller: ServerProfilesController;
  let mockServerProfilesService: jest.Mocked<ServerProfilesService>;

  const userId = 'user-uuid';
  const profileId = 'profile-uuid';

  beforeEach(async () => {
    mockServerProfilesService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      testConnection: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServerProfilesController],
      providers: [
        { provide: ServerProfilesService, useValue: mockServerProfilesService },
      ],
    }).compile();

    controller = module.get<ServerProfilesController>(ServerProfilesController);
  });

  describe('findAll', () => {
    it('should return paginated server profiles for the current user', async () => {
      const query = { page: 1, pageSize: 20 } as any;
      const serviceResult = {
        items: [{ id: profileId, name: 'My Server' }],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockServerProfilesService.findAll.mockResolvedValue(serviceResult as any);

      const result = await controller.findAll(userId, query);

      expect(result).toEqual(serviceResult);
      expect(mockServerProfilesService.findAll).toHaveBeenCalledWith(userId, query);
    });

    it('should pass search query to service', async () => {
      const query = { page: 1, pageSize: 20, search: 'prod' } as any;
      mockServerProfilesService.findAll.mockResolvedValue({ items: [], total: 0 } as any);

      await controller.findAll(userId, query);

      expect(mockServerProfilesService.findAll).toHaveBeenCalledWith(userId, query);
    });

    it('should propagate service errors', async () => {
      mockServerProfilesService.findAll.mockRejectedValue(new Error('DB error'));

      await expect(controller.findAll(userId, {} as any)).rejects.toThrow('DB error');
    });
  });

  describe('findOne', () => {
    it('should return a server profile by id for the current user', async () => {
      const serviceResult = { id: profileId, name: 'My Server', userId };
      mockServerProfilesService.findOne.mockResolvedValue(serviceResult as any);

      const result = await controller.findOne(profileId, userId);

      expect(result).toEqual(serviceResult);
      expect(mockServerProfilesService.findOne).toHaveBeenCalledWith(profileId, userId);
    });

    it('should propagate NotFoundException when profile not found', async () => {
      mockServerProfilesService.findOne.mockRejectedValue(
        new NotFoundException('Server profile not found'),
      );

      await expect(controller.findOne('missing-uuid', userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a server profile for the current user and return result', async () => {
      const dto = { name: 'New Server', host: '192.168.1.1', port: 22, username: 'admin' } as any;
      const serviceResult = { id: profileId, ...dto, userId };
      mockServerProfilesService.create.mockResolvedValue(serviceResult as any);

      const result = await controller.create(userId, dto);

      expect(result).toEqual(serviceResult);
      expect(mockServerProfilesService.create).toHaveBeenCalledWith(userId, dto);
    });

    it('should propagate service errors on create', async () => {
      mockServerProfilesService.create.mockRejectedValue(new Error('Encryption error'));

      await expect(controller.create(userId, {} as any)).rejects.toThrow('Encryption error');
    });
  });

  describe('update', () => {
    it('should update a server profile and return the updated result', async () => {
      const dto = { name: 'Updated Server' } as any;
      const serviceResult = { id: profileId, name: 'Updated Server', userId };
      mockServerProfilesService.update.mockResolvedValue(serviceResult as any);

      const result = await controller.update(profileId, userId, dto);

      expect(result).toEqual(serviceResult);
      expect(mockServerProfilesService.update).toHaveBeenCalledWith(profileId, userId, dto);
    });

    it('should propagate NotFoundException when profile not found', async () => {
      mockServerProfilesService.update.mockRejectedValue(
        new NotFoundException('Server profile not found'),
      );

      await expect(controller.update('missing-uuid', userId, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete a server profile and return undefined', async () => {
      mockServerProfilesService.remove.mockResolvedValue(undefined as any);

      const result = await controller.remove(profileId, userId);

      expect(result).toBeUndefined();
      expect(mockServerProfilesService.remove).toHaveBeenCalledWith(profileId, userId);
    });

    it('should propagate NotFoundException when profile not found', async () => {
      mockServerProfilesService.remove.mockRejectedValue(
        new NotFoundException('Server profile not found'),
      );

      await expect(controller.remove('missing-uuid', userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('testConnection', () => {
    it('should return connection test result for the given profile', async () => {
      const serviceResult = { success: true, latencyMs: 42 };
      mockServerProfilesService.testConnection.mockResolvedValue(serviceResult as any);

      const result = await controller.testConnection(profileId, userId);

      expect(result).toEqual(serviceResult);
      expect(mockServerProfilesService.testConnection).toHaveBeenCalledWith(profileId, userId);
    });

    it('should return failure result when connection fails', async () => {
      const serviceResult = { success: false, error: 'Connection refused' };
      mockServerProfilesService.testConnection.mockResolvedValue(serviceResult as any);

      const result = await controller.testConnection(profileId, userId);

      expect(result).toEqual(serviceResult);
    });

    it('should propagate NotFoundException when profile not found', async () => {
      mockServerProfilesService.testConnection.mockRejectedValue(
        new NotFoundException('Server profile not found'),
      );

      await expect(controller.testConnection('missing-uuid', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
