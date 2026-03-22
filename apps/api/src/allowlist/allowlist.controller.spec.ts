import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { AllowlistController } from './allowlist.controller';
import { AllowlistService } from './allowlist.service';

describe('AllowlistController', () => {
  let controller: AllowlistController;
  let mockAllowlistService: jest.Mocked<AllowlistService>;

  beforeEach(async () => {
    mockAllowlistService = {
      listAllowedEmails: jest.fn(),
      addEmail: jest.fn(),
      removeEmail: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AllowlistController],
      providers: [
        { provide: AllowlistService, useValue: mockAllowlistService },
      ],
    }).compile();

    controller = module.get<AllowlistController>(AllowlistController);
  });

  describe('listAllowedEmails', () => {
    it('should return paginated allowlist from service', async () => {
      const query = { page: 1, pageSize: 20 } as any;
      const serviceResult = {
        items: [{ id: 'uuid-1', email: 'user@example.com' }],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockAllowlistService.listAllowedEmails.mockResolvedValue(serviceResult as any);

      const result = await controller.listAllowedEmails(query);

      expect(result).toEqual(serviceResult);
      expect(mockAllowlistService.listAllowedEmails).toHaveBeenCalledWith(query);
    });

    it('should pass all query params to the service', async () => {
      const query = {
        page: 2,
        pageSize: 10,
        search: 'test',
        status: 'pending',
        sortBy: 'email',
        sortOrder: 'asc',
      } as any;
      mockAllowlistService.listAllowedEmails.mockResolvedValue({ items: [], total: 0 } as any);

      await controller.listAllowedEmails(query);

      expect(mockAllowlistService.listAllowedEmails).toHaveBeenCalledWith(query);
    });

    it('should propagate service errors', async () => {
      const query = {} as any;
      mockAllowlistService.listAllowedEmails.mockRejectedValue(new Error('DB error'));

      await expect(controller.listAllowedEmails(query)).rejects.toThrow('DB error');
    });
  });

  describe('addEmail', () => {
    it('should call service with dto and adminUserId and return result', async () => {
      const dto = { email: 'new@example.com' } as any;
      const adminUserId = 'admin-uuid';
      const serviceResult = { id: 'entry-uuid', email: 'new@example.com' };
      mockAllowlistService.addEmail.mockResolvedValue(serviceResult as any);

      const result = await controller.addEmail(dto, adminUserId);

      expect(result).toEqual(serviceResult);
      expect(mockAllowlistService.addEmail).toHaveBeenCalledWith(dto, adminUserId);
    });

    it('should propagate ConflictException from service', async () => {
      const dto = { email: 'existing@example.com' } as any;
      const adminUserId = 'admin-uuid';
      mockAllowlistService.addEmail.mockRejectedValue(
        new ConflictException('Email already in allowlist'),
      );

      await expect(controller.addEmail(dto, adminUserId)).rejects.toThrow(ConflictException);
    });
  });

  describe('removeEmail', () => {
    it('should call service with id and adminUserId', async () => {
      const id = 'entry-uuid';
      const adminUserId = 'admin-uuid';
      mockAllowlistService.removeEmail.mockResolvedValue(undefined as any);

      await controller.removeEmail(id, adminUserId);

      expect(mockAllowlistService.removeEmail).toHaveBeenCalledWith(id, adminUserId);
    });

    it('should return undefined (204 No Content)', async () => {
      mockAllowlistService.removeEmail.mockResolvedValue(undefined as any);

      const result = await controller.removeEmail('entry-uuid', 'admin-uuid');

      expect(result).toBeUndefined();
    });

    it('should propagate NotFoundException from service', async () => {
      mockAllowlistService.removeEmail.mockRejectedValue(
        new NotFoundException('Allowlist entry not found'),
      );

      await expect(controller.removeEmail('missing-uuid', 'admin-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should propagate BadRequestException for claimed entry', async () => {
      mockAllowlistService.removeEmail.mockRejectedValue(
        new BadRequestException('Cannot remove a claimed allowlist entry'),
      );

      await expect(controller.removeEmail('claimed-uuid', 'admin-uuid')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
