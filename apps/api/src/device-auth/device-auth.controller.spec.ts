import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeviceAuthController } from './device-auth.controller';
import { DeviceAuthService } from './device-auth.service';

describe('DeviceAuthController', () => {
  let controller: DeviceAuthController;
  let mockDeviceAuthService: jest.Mocked<DeviceAuthService>;

  const mockUser = { id: 'user-uuid', email: 'test@example.com' };

  beforeEach(async () => {
    mockDeviceAuthService = {
      generateDeviceCode: jest.fn(),
      pollForToken: jest.fn(),
      getActivationInfo: jest.fn(),
      authorizeDevice: jest.fn(),
      getUserDeviceSessions: jest.fn(),
      revokeDeviceSession: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceAuthController],
      providers: [
        { provide: DeviceAuthService, useValue: mockDeviceAuthService },
      ],
    }).compile();

    controller = module.get<DeviceAuthController>(DeviceAuthController);
  });

  describe('generateCode', () => {
    it('should return device code wrapped in data envelope', async () => {
      const deviceCodeResult = {
        deviceCode: 'device-code-hex',
        userCode: 'ABCD-1234',
        verificationUri: 'http://example.com/device',
        expiresIn: 900,
        interval: 5,
      };
      mockDeviceAuthService.generateDeviceCode.mockResolvedValue(deviceCodeResult as any);

      const body = { clientInfo: { name: 'My CLI' } } as any;
      const result = await controller.generateCode(body);

      expect(result).toEqual({ data: deviceCodeResult });
      expect(mockDeviceAuthService.generateDeviceCode).toHaveBeenCalledWith(body.clientInfo);
    });

    it('should pass undefined clientInfo when not provided', async () => {
      mockDeviceAuthService.generateDeviceCode.mockResolvedValue({} as any);

      const body = {} as any;
      await controller.generateCode(body);

      expect(mockDeviceAuthService.generateDeviceCode).toHaveBeenCalledWith(undefined);
    });

    it('should propagate service errors', async () => {
      mockDeviceAuthService.generateDeviceCode.mockRejectedValue(new Error('DB error'));

      await expect(controller.generateCode({} as any)).rejects.toThrow('DB error');
    });
  });

  describe('pollToken', () => {
    it('should return token result wrapped in data envelope', async () => {
      const tokenResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'bearer',
        expiresIn: 900,
      };
      mockDeviceAuthService.pollForToken.mockResolvedValue(tokenResult as any);

      const body = { deviceCode: 'device-code-hex' } as any;
      const result = await controller.pollToken(body);

      expect(result).toEqual({ data: tokenResult });
      expect(mockDeviceAuthService.pollForToken).toHaveBeenCalledWith('device-code-hex');
    });

    it('should propagate BadRequestException for authorization_pending', async () => {
      mockDeviceAuthService.pollForToken.mockRejectedValue(
        new BadRequestException({ error: 'authorization_pending' }),
      );

      await expect(controller.pollToken({ deviceCode: 'code' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getActivationInfo', () => {
    it('should return activation info wrapped in data envelope', async () => {
      const activationInfo = {
        code: 'ABCD-1234',
        clientInfo: { name: 'My CLI' },
        expiresAt: new Date().toISOString(),
      };
      mockDeviceAuthService.getActivationInfo.mockResolvedValue(activationInfo as any);

      const result = await controller.getActivationInfo('ABCD-1234');

      expect(result).toEqual({ data: activationInfo });
      expect(mockDeviceAuthService.getActivationInfo).toHaveBeenCalledWith('ABCD-1234');
    });

    it('should pass undefined when no code query param provided', async () => {
      mockDeviceAuthService.getActivationInfo.mockResolvedValue({} as any);

      await controller.getActivationInfo(undefined);

      expect(mockDeviceAuthService.getActivationInfo).toHaveBeenCalledWith(undefined);
    });

    it('should propagate NotFoundException for unknown code', async () => {
      mockDeviceAuthService.getActivationInfo.mockRejectedValue(
        new NotFoundException('Code not found'),
      );

      await expect(controller.getActivationInfo('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('authorizeDevice', () => {
    it('should call service with user id, userCode, and approve flag', async () => {
      const authorizeResult = { success: true, message: 'Device authorized' };
      mockDeviceAuthService.authorizeDevice.mockResolvedValue(authorizeResult as any);

      const body = { userCode: 'ABCD-1234', approve: true } as any;
      const result = await controller.authorizeDevice(mockUser as any, body);

      expect(result).toEqual({ data: authorizeResult });
      expect(mockDeviceAuthService.authorizeDevice).toHaveBeenCalledWith(
        'user-uuid',
        'ABCD-1234',
        true,
      );
    });

    it('should handle deny decision (approve: false)', async () => {
      const denyResult = { success: true, message: 'Device denied' };
      mockDeviceAuthService.authorizeDevice.mockResolvedValue(denyResult as any);

      const body = { userCode: 'ABCD-1234', approve: false } as any;
      const result = await controller.authorizeDevice(mockUser as any, body);

      expect(result).toEqual({ data: denyResult });
      expect(mockDeviceAuthService.authorizeDevice).toHaveBeenCalledWith(
        'user-uuid',
        'ABCD-1234',
        false,
      );
    });

    it('should propagate BadRequestException for invalid code', async () => {
      mockDeviceAuthService.authorizeDevice.mockRejectedValue(
        new BadRequestException('Invalid or expired code'),
      );

      await expect(
        controller.authorizeDevice(mockUser as any, { userCode: 'BAD', approve: true } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSessions', () => {
    it('should return paginated sessions with default page and limit', async () => {
      const sessionsResult = { sessions: [], total: 0, page: 1, limit: 10 };
      mockDeviceAuthService.getUserDeviceSessions.mockResolvedValue(sessionsResult as any);

      const result = await controller.getSessions(mockUser as any, undefined, undefined);

      expect(result).toEqual({ data: sessionsResult });
      expect(mockDeviceAuthService.getUserDeviceSessions).toHaveBeenCalledWith(
        'user-uuid',
        1,
        10,
      );
    });

    it('should parse page and limit query params', async () => {
      const sessionsResult = { sessions: [], total: 0, page: 2, limit: 5 };
      mockDeviceAuthService.getUserDeviceSessions.mockResolvedValue(sessionsResult as any);

      const result = await controller.getSessions(mockUser as any, '2', '5');

      expect(result).toEqual({ data: sessionsResult });
      expect(mockDeviceAuthService.getUserDeviceSessions).toHaveBeenCalledWith(
        'user-uuid',
        2,
        5,
      );
    });

    it('should propagate service errors', async () => {
      mockDeviceAuthService.getUserDeviceSessions.mockRejectedValue(new Error('DB error'));

      await expect(controller.getSessions(mockUser as any, undefined, undefined)).rejects.toThrow(
        'DB error',
      );
    });
  });

  describe('revokeSession', () => {
    it('should revoke session and return result wrapped in data envelope', async () => {
      const revokeResult = { success: true, message: 'Session revoked' };
      mockDeviceAuthService.revokeDeviceSession.mockResolvedValue(revokeResult as any);

      const result = await controller.revokeSession(mockUser as any, 'session-uuid');

      expect(result).toEqual({ data: revokeResult });
      expect(mockDeviceAuthService.revokeDeviceSession).toHaveBeenCalledWith(
        'user-uuid',
        'session-uuid',
      );
    });

    it('should propagate NotFoundException for missing session', async () => {
      mockDeviceAuthService.revokeDeviceSession.mockRejectedValue(
        new NotFoundException('Session not found'),
      );

      await expect(
        controller.revokeSession(mockUser as any, 'missing-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
