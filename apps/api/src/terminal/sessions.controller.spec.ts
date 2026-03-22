import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

describe('SessionsController', () => {
  let controller: SessionsController;
  let mockSessionsService: jest.Mocked<SessionsService>;

  const userId = 'user-uuid';
  const sessionId = 'session-uuid';

  const mockSession = {
    id: sessionId,
    name: 'My Terminal',
    status: 'active',
    userId,
    createdAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockSessionsService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      terminate: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: mockSessionsService },
      ],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  describe('findAll', () => {
    it('should return paginated sessions for the current user', async () => {
      const query = { page: 1, pageSize: 20 } as any;
      const serviceResult = {
        items: [mockSession],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockSessionsService.findAll.mockResolvedValue(serviceResult as any);

      const result = await controller.findAll(userId, query);

      expect(result).toEqual(serviceResult);
      expect(mockSessionsService.findAll).toHaveBeenCalledWith(userId, query);
    });

    it('should pass status filter to service', async () => {
      const query = { page: 1, pageSize: 20, status: 'active' } as any;
      mockSessionsService.findAll.mockResolvedValue({ items: [], total: 0 } as any);

      await controller.findAll(userId, query);

      expect(mockSessionsService.findAll).toHaveBeenCalledWith(userId, query);
    });

    it('should propagate service errors', async () => {
      mockSessionsService.findAll.mockRejectedValue(new Error('DB error'));

      await expect(controller.findAll(userId, {} as any)).rejects.toThrow('DB error');
    });
  });

  describe('findOne', () => {
    it('should return a session by id for the current user', async () => {
      mockSessionsService.findOne.mockResolvedValue(mockSession as any);

      const result = await controller.findOne(sessionId, userId);

      expect(result).toEqual(mockSession);
      expect(mockSessionsService.findOne).toHaveBeenCalledWith(sessionId, userId);
    });

    it('should propagate NotFoundException when session not found', async () => {
      mockSessionsService.findOne.mockRejectedValue(
        new NotFoundException('Terminal session not found'),
      );

      await expect(controller.findOne('missing-uuid', userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a session for the current user and return result', async () => {
      const dto = { name: 'New Terminal', serverProfileId: 'profile-uuid' } as any;
      mockSessionsService.create.mockResolvedValue(mockSession as any);

      const result = await controller.create(userId, dto);

      expect(result).toEqual(mockSession);
      expect(mockSessionsService.create).toHaveBeenCalledWith(userId, dto);
    });

    it('should propagate service errors on create', async () => {
      mockSessionsService.create.mockRejectedValue(new Error('SSH connection failed'));

      await expect(controller.create(userId, {} as any)).rejects.toThrow('SSH connection failed');
    });
  });

  describe('update', () => {
    it('should rename a session and return the updated result', async () => {
      const dto = { name: 'Renamed Terminal' } as any;
      const updatedSession = { ...mockSession, name: 'Renamed Terminal' };
      mockSessionsService.update.mockResolvedValue(updatedSession as any);

      const result = await controller.update(sessionId, userId, dto);

      expect(result).toEqual(updatedSession);
      expect(mockSessionsService.update).toHaveBeenCalledWith(sessionId, userId, dto);
    });

    it('should propagate NotFoundException when session not found', async () => {
      mockSessionsService.update.mockRejectedValue(
        new NotFoundException('Terminal session not found'),
      );

      await expect(controller.update('missing-uuid', userId, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('terminate', () => {
    it('should terminate a session and return undefined', async () => {
      mockSessionsService.terminate.mockResolvedValue(undefined as any);

      const result = await controller.terminate(sessionId, userId);

      expect(result).toBeUndefined();
      expect(mockSessionsService.terminate).toHaveBeenCalledWith(sessionId, userId);
    });

    it('should propagate NotFoundException when session not found', async () => {
      mockSessionsService.terminate.mockRejectedValue(
        new NotFoundException('Terminal session not found'),
      );

      await expect(controller.terminate('missing-uuid', userId)).rejects.toThrow(NotFoundException);
    });
  });
});
