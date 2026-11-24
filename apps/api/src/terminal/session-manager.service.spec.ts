import { Test, TestingModule } from '@nestjs/testing';
import { SessionManagerService } from './session-manager.service';
import { SshService, SshConnection } from './ssh.service';
import { SessionsService } from './sessions.service';
import { EventEmitter } from 'events';

describe('SessionManagerService', () => {
  let service: SessionManagerService;
  let sshService: SshService;
  let sessionsService: SessionsService;

  const mockSessionId = 'session-123';
  const mockTmuxSessionId = 'sk-abcd1234';
  const mockProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    orgId: '33333333-3333-4333-8333-333333333333',
    hostname: 'example.com',
    port: 22,
    username: 'admin',
    authMethod: 'password' as const,
    password: 'secret',
  };

  function createMockSshConnection(): SshConnection {
    const stream = new EventEmitter() as any;
    stream.write = jest.fn();
    stream.close = jest.fn();
    stream.setWindow = jest.fn();
    stream.removeListener = jest.fn();

    return {
      client: new EventEmitter() as any,
      stream,
      close: jest.fn(),
      resize: jest.fn(),
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        {
          provide: SshService,
          useValue: {
            connect: jest.fn(),
          },
        },
        {
          provide: SessionsService,
          useValue: {
            updateActivity: jest.fn().mockResolvedValue(undefined),
            updateStatus: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<SessionManagerService>(SessionManagerService);
    sshService = module.get<SshService>(SshService);
    sessionsService = module.get<SessionsService>(SessionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startSession', () => {
    it('should create SSH connection and store in map', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      expect(sshService.connect).toHaveBeenCalledWith(
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );
      expect(service.isSessionRunning(mockSessionId)).toBe(true);
    });

    it('should not create duplicate session if already running', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );
      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      expect(sshService.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('attachWebSocket', () => {
    it('should return true for existing session', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1; // WebSocket.OPEN
      mockWs.send = jest.fn();

      const result = service.attachWebSocket(mockSessionId, mockWs);

      expect(result).toBe(true);
    });

    it('should return false for non-existent session', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = jest.fn();

      const result = service.attachWebSocket('nonexistent', mockWs);

      expect(result).toBe(false);
    });
  });

  describe('detachWebSocket', () => {
    const wsStub = () => Object.assign(new EventEmitter(), { readyState: 1, send: jest.fn() }) as any;

    it('detaches one client; the last one leaves the row detached and the stream open', async () => {
      const conn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(conn);
      await service.startSession(mockSessionId, mockProfile, mockTmuxSessionId, 80, 24);
      const a = wsStub();
      const b = wsStub();
      service.attachWebSocket(mockSessionId, a);
      service.attachWebSocket(mockSessionId, b);

      service.detachWebSocket(mockSessionId, a);
      expect(sessionsService.updateStatus).not.toHaveBeenCalled();
      service.detachWebSocket(mockSessionId, b);
      expect(sessionsService.updateStatus).toHaveBeenCalledWith(mockSessionId, 'detached');
      expect(service.isSessionRunning(mockSessionId)).toBe(true);
      expect(conn.close).not.toHaveBeenCalled();

      // The later socket close does not detach twice.
      b.emit('close');
      expect(sessionsService.updateStatus).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an unknown session', () => {
      expect(() => service.detachWebSocket('nope', wsStub())).not.toThrow();
    });
  });

  describe('sendInput', () => {
    it('should write to SSH stream for existing session', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      const inputData = Buffer.from('ls -la\n');
      service.sendInput(mockSessionId, inputData);

      expect(mockConn.stream.write).toHaveBeenCalledWith(inputData);
    });

    it('should do nothing for non-existent session', () => {
      expect(() => {
        service.sendInput('nonexistent', Buffer.from('test'));
      }).not.toThrow();
    });
  });

  describe('resizeSession', () => {
    it('should call ssh resize for existing session', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      service.resizeSession(mockSessionId, 120, 40);

      expect(mockConn.resize).toHaveBeenCalledWith(120, 40);
    });

    it('should do nothing for non-existent session', () => {
      expect(() => {
        service.resizeSession('nonexistent', 120, 40);
      }).not.toThrow();
    });
  });

  describe('terminateSession', () => {
    it('should close SSH and remove from map', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      expect(service.isSessionRunning(mockSessionId)).toBe(true);

      await service.terminateSession(mockSessionId);

      expect(mockConn.close).toHaveBeenCalled();
      expect(service.isSessionRunning(mockSessionId)).toBe(false);
    });

    it('should do nothing for non-existent session', async () => {
      await expect(
        service.terminateSession('nonexistent'),
      ).resolves.toBeUndefined();
    });
  });

  describe('isSessionRunning', () => {
    it('should return true for running session', async () => {
      const mockConn = createMockSshConnection();
      (sshService.connect as jest.Mock).mockResolvedValue(mockConn);

      await service.startSession(
        mockSessionId,
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      expect(service.isSessionRunning(mockSessionId)).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(service.isSessionRunning('nonexistent')).toBe(false);
    });
  });
});
