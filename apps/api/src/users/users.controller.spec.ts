import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let mockUsersService: jest.Mocked<UsersService>;

  const adminUserId = 'admin-uuid';
  const targetUserId = 'target-uuid';

  const mockUser = {
    id: targetUserId,
    email: 'user@example.com',
    displayName: 'Test User',
    isActive: true,
    roles: [{ name: 'Viewer' }],
    createdAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockUsersService = {
      listUsers: jest.fn(),
      getUserById: jest.fn(),
      updateUser: jest.fn(),
      updateUserRoles: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('listUsers', () => {
    it('should return paginated user list from service', async () => {
      const query = { page: 1, pageSize: 20 } as any;
      const serviceResult = {
        items: [mockUser],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockUsersService.listUsers.mockResolvedValue(serviceResult as any);

      const result = await controller.listUsers(query);

      expect(result).toEqual(serviceResult);
      expect(mockUsersService.listUsers).toHaveBeenCalledWith(query);
    });

    it('should pass all filter parameters to service', async () => {
      const query = {
        page: 1,
        pageSize: 10,
        search: 'alice',
        role: 'Admin',
        isActive: true,
        sortBy: 'email',
        sortOrder: 'asc',
      } as any;
      mockUsersService.listUsers.mockResolvedValue({ items: [], total: 0 } as any);

      await controller.listUsers(query);

      expect(mockUsersService.listUsers).toHaveBeenCalledWith(query);
    });

    it('should propagate service errors', async () => {
      mockUsersService.listUsers.mockRejectedValue(new Error('DB error'));

      await expect(controller.listUsers({} as any)).rejects.toThrow('DB error');
    });
  });

  describe('getUserById', () => {
    it('should return a user by id', async () => {
      mockUsersService.getUserById.mockResolvedValue(mockUser as any);

      const result = await controller.getUserById(targetUserId);

      expect(result).toEqual(mockUser);
      expect(mockUsersService.getUserById).toHaveBeenCalledWith(targetUserId);
    });

    it('should propagate NotFoundException when user not found', async () => {
      mockUsersService.getUserById.mockRejectedValue(new NotFoundException('User not found'));

      await expect(controller.getUserById('missing-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateUser', () => {
    it('should update user and return the updated user', async () => {
      const dto = { isActive: false } as any;
      const updatedUser = { ...mockUser, isActive: false };
      mockUsersService.updateUser.mockResolvedValue(updatedUser as any);

      const result = await controller.updateUser(targetUserId, dto, adminUserId);

      expect(result).toEqual(updatedUser);
      expect(mockUsersService.updateUser).toHaveBeenCalledWith(targetUserId, dto, adminUserId);
    });

    it('should propagate ForbiddenException when admin tries to deactivate self', async () => {
      const dto = { isActive: false } as any;
      mockUsersService.updateUser.mockRejectedValue(
        new ForbiddenException('Cannot deactivate self'),
      );

      await expect(controller.updateUser(adminUserId, dto, adminUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should propagate NotFoundException when user not found', async () => {
      mockUsersService.updateUser.mockRejectedValue(new NotFoundException('User not found'));

      await expect(
        controller.updateUser('missing-uuid', {} as any, adminUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateUserRoles', () => {
    it('should update user roles and return the updated user', async () => {
      const dto = { roles: ['Contributor'] } as any;
      const updatedUser = { ...mockUser, roles: [{ name: 'Contributor' }] };
      mockUsersService.updateUserRoles.mockResolvedValue(updatedUser as any);

      const result = await controller.updateUserRoles(targetUserId, dto, adminUserId);

      expect(result).toEqual(updatedUser);
      expect(mockUsersService.updateUserRoles).toHaveBeenCalledWith(
        targetUserId,
        dto,
        adminUserId,
      );
    });

    it('should propagate BadRequestException for invalid role names', async () => {
      const dto = { roles: ['NonexistentRole'] } as any;
      mockUsersService.updateUserRoles.mockRejectedValue(
        new BadRequestException('Invalid role names'),
      );

      await expect(
        controller.updateUserRoles(targetUserId, dto, adminUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate ForbiddenException when admin removes own admin role', async () => {
      const dto = { roles: ['Viewer'] } as any;
      mockUsersService.updateUserRoles.mockRejectedValue(
        new ForbiddenException('Cannot remove own admin role'),
      );

      await expect(
        controller.updateUserRoles(adminUserId, dto, adminUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate NotFoundException when user not found', async () => {
      mockUsersService.updateUserRoles.mockRejectedValue(new NotFoundException('User not found'));

      await expect(
        controller.updateUserRoles('missing-uuid', { roles: [] } as any, adminUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
