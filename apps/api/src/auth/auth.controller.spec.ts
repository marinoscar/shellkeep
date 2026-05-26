import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: jest.Mocked<AuthService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockAuthService = {
      getEnabledProviders: jest.fn(),
      handleGoogleLogin: jest.fn(),
      getCurrentUser: jest.fn(),
      logout: jest.fn(),
      refreshAccessToken: jest.fn(),
    } as any;

    mockConfigService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('getProviders', () => {
    it('should return enabled providers', async () => {
      const providers = [{ name: 'google', enabled: true }];
      mockAuthService.getEnabledProviders.mockResolvedValue(providers);

      const result = await controller.getProviders();

      expect(result).toEqual({
        data: {
          providers,
        },
      });
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user details', async () => {
      const userDetails = {
        id: 'user-1',
        email: 'test@example.com',
        displayName: 'Test User',
        profileImageUrl: null,
        isActive: true,
        roles: [{ name: 'viewer' }],
        permissions: ['user_settings:read'],
      };
      mockAuthService.getCurrentUser.mockResolvedValue(userDetails as any);

      const requestUser = { id: 'user-1', email: 'test@example.com' };
      const result = await controller.getCurrentUser(requestUser as any);

      expect(result).toEqual({
        data: userDetails,
      });
      expect(mockAuthService.getCurrentUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('refresh', () => {
    const ROTATED_REFRESH = 'rotated-refresh-token';
    const NEW_ACCESS = 'new-access-token';
    const EXPIRES_IN = 900;

    const mockTokens = {
      accessToken: NEW_ACCESS,
      refreshToken: ROTATED_REFRESH,
      expiresIn: EXPIRES_IN,
    };

    function createMockRes() {
      return { setCookie: jest.fn(), clearCookie: jest.fn() } as any;
    }

    it('cookie present: calls refreshAccessToken with cookie value, sets rotated cookie, returns { accessToken, expiresIn } only', async () => {
      mockAuthService.refreshAccessToken.mockResolvedValue(mockTokens);
      const mockReq = { cookies: { refresh_token: 'cookie-token' } } as any;
      const mockRes = createMockRes();

      const result = await controller.refresh(mockReq, mockRes, {} as any);

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('cookie-token');
      expect(mockRes.setCookie).toHaveBeenCalledTimes(1);
      expect(mockRes.setCookie).toHaveBeenCalledWith(
        'refresh_token',
        ROTATED_REFRESH,
        expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
      );
      expect(result).toEqual({ accessToken: NEW_ACCESS, expiresIn: EXPIRES_IN });
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('body present, no cookie: calls refreshAccessToken with body value, does NOT set cookie, returns { accessToken, refreshToken, expiresIn }', async () => {
      mockAuthService.refreshAccessToken.mockResolvedValue(mockTokens);
      const mockReq = { cookies: {} } as any;
      const mockRes = createMockRes();
      const body = { refreshToken: 'body-token' } as any;

      const result = await controller.refresh(mockReq, mockRes, body);

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('body-token');
      expect(mockRes.setCookie).not.toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: NEW_ACCESS,
        refreshToken: ROTATED_REFRESH,
        expiresIn: EXPIRES_IN,
      });
    });

    it('both cookie and body present: cookie wins, behaves like cookie path', async () => {
      mockAuthService.refreshAccessToken.mockResolvedValue(mockTokens);
      const mockReq = { cookies: { refresh_token: 'cookie-token' } } as any;
      const mockRes = createMockRes();
      const body = { refreshToken: 'body-token' } as any;

      const result = await controller.refresh(mockReq, mockRes, body);

      // cookie value must be used, not body value
      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith('cookie-token');
      expect(mockRes.setCookie).toHaveBeenCalledTimes(1);
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('neither cookie nor body present: throws UnauthorizedException', async () => {
      const mockReq = { cookies: {} } as any;
      const mockRes = createMockRes();

      await expect(
        controller.refresh(mockReq, mockRes, {} as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAuthService.refreshAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should call auth service logout and return void', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);

      const requestUser = { id: 'user-1', email: 'test@example.com' };
      const mockReq = { cookies: {} } as any;
      const mockRes = { clearCookie: jest.fn() } as any;

      const result = await controller.logout(requestUser as any, mockReq, mockRes);

      expect(result).toBeUndefined();
      expect(mockAuthService.logout).toHaveBeenCalledWith('user-1', undefined);
      expect(mockRes.clearCookie).toHaveBeenCalled();
    });
  });
});
