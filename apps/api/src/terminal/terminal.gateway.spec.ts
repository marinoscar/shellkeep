import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter } from 'events';
import { TerminalGateway } from './terminal.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { ServerProfilesService } from '../server-profiles/server-profiles.service';
import { SessionsService } from './sessions.service';
import { SessionManagerService } from './session-manager.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal WebSocket stand-in that emits real events so gateway message
 *  listeners fire, while exposing Jest spies for assertions. */
function createMockWebSocket() {
  const emitter = new EventEmitter();
  const ws: any = Object.assign(emitter, {
    readyState: 1, // WebSocket.OPEN
    send: jest.fn(),
    close: jest.fn(),
    ping: jest.fn(),
  });
  return ws;
}

/** Emit a text control message on the mock ws, triggering the gateway's
 *  `message` listener registered in handleConnection. */
function emitMessage(ws: any, payload: object, isBinary = false): void {
  ws.emit('message', Buffer.from(JSON.stringify(payload)), isBinary);
}

/** Emit binary (terminal input) data on the mock ws. */
function emitBinaryMessage(ws: any, data: Buffer): void {
  ws.emit('message', data, true);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TerminalGateway', () => {
  let gateway: TerminalGateway;
  let jwtService: jest.Mocked<JwtService>;
  let prisma: { user: { findUnique: jest.Mock } };
  let serverProfilesService: jest.Mocked<Pick<ServerProfilesService, 'getDecryptedProfile'>>;
  let sessionsService: jest.Mocked<Pick<SessionsService, 'findOne' | 'updateStatus'>>;
  let sessionManager: jest.Mocked<
    Pick<SessionManagerService, 'isSessionRunning' | 'startSession' | 'attachWebSocket' | 'sendInput' | 'resizeSession'>
  >;

  const VALID_USER_ID = 'user-abc-123';
  const VALID_TOKEN = 'valid.jwt.token';
  const SESSION_ID = 'session-xyz-456';

  const mockActiveUser = {
    id: VALID_USER_ID,
    email: 'user@example.com',
    isActive: true,
  };

  const mockSession = {
    id: SESSION_ID,
    userId: VALID_USER_ID,
    serverProfileId: 'profile-111',
    tmuxSessionId: 'sk-abcd1234',
    status: 'active',
    cols: 80,
    rows: 24,
    name: 'my-session',
  };

  const mockDecryptedProfile = {
    hostname: 'example.com',
    port: 22,
    username: 'admin',
    authMethod: 'password' as const,
    password: 'secret',
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    prisma = {
      user: {
        findUnique: jest.fn(),
      },
    };

    jwtService = {
      verify: jest.fn(),
    } as any;

    serverProfilesService = {
      getDecryptedProfile: jest.fn(),
    } as any;

    sessionsService = {
      findOne: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    } as any;

    sessionManager = {
      isSessionRunning: jest.fn(),
      startSession: jest.fn().mockResolvedValue(undefined),
      attachWebSocket: jest.fn().mockReturnValue(true),
      sendInput: jest.fn(),
      resizeSession: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TerminalGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
        { provide: ServerProfilesService, useValue: serverProfilesService },
        { provide: SessionsService, useValue: sessionsService },
        { provide: SessionManagerService, useValue: sessionManager },
      ],
    }).compile();

    gateway = module.get<TerminalGateway>(TerminalGateway);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // handleConnection
  // -------------------------------------------------------------------------

  describe('handleConnection', () => {
    it('should register the client and set an auth timeout', () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      // No message or close calls yet — just connected
      expect(ws.send).not.toHaveBeenCalled();
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should send auth_fail and close the socket when auth timeout fires', () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      // Fast-forward past the 5 second auth deadline
      jest.advanceTimersByTime(5001);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_fail', reason: 'Authentication timeout' }),
      );
      expect(ws.close).toHaveBeenCalled();
    });

    it('should NOT fire auth timeout when client authenticates in time', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);

      // Authenticate before the timeout
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });

      // Allow the async auth handler to resolve
      await Promise.resolve();
      await Promise.resolve();

      // Auth succeeded — advancing past the deadline should NOT trigger another close
      ws.close.mockClear();
      ws.send.mockClear();
      jest.advanceTimersByTime(5001);

      expect(ws.close).not.toHaveBeenCalled();
      // No auth_fail after successful auth
      const calls = ws.send.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContain(
        expect.stringContaining('auth_fail'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleDisconnect
  // -------------------------------------------------------------------------

  describe('handleDisconnect', () => {
    it('should clear auth timeout and remove client from map on disconnect', () => {
      const ws = createMockWebSocket();
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      gateway.handleConnection(ws);
      gateway.handleDisconnect(ws);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear ping interval when authenticated client disconnects', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      gateway.handleDisconnect(ws);

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should be a no-op when called with an unknown socket', () => {
      const ws = createMockWebSocket();
      // Never called handleConnection, so ws is not in the map
      expect(() => gateway.handleDisconnect(ws)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Authentication flow (auth message)
  // -------------------------------------------------------------------------

  describe('auth message handling', () => {
    it('should send auth_ok and start ping interval on valid token and active user', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      expect(jwtService.verify).toHaveBeenCalledWith(VALID_TOKEN);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: VALID_USER_ID },
      });
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_ok' }),
      );
    });

    it('should send auth_fail and close socket when token is invalid', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: 'bad.token' });
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_fail', reason: 'Invalid token' }),
      );
      expect(ws.close).toHaveBeenCalled();
    });

    it('should send auth_fail and close socket when user does not exist', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: 'ghost-user' });
      prisma.user.findUnique.mockResolvedValue(null);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_fail', reason: 'Invalid user' }),
      );
      expect(ws.close).toHaveBeenCalled();
    });

    it('should send auth_fail and close socket when user is inactive', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue({ ...mockActiveUser, isActive: false });

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_fail', reason: 'Invalid user' }),
      );
      expect(ws.close).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Ping / pong heartbeat
  // -------------------------------------------------------------------------

  describe('ping/pong heartbeat', () => {
    it('should respond with pong when authenticated client sends ping', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      ws.send.mockClear();
      emitMessage(ws, { type: 'ping' });
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
    });

    it('should send WebSocket-level ping every 30 seconds after authentication', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      ws.ping.mockClear();
      jest.advanceTimersByTime(30000);

      expect(ws.ping).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(30000);
      expect(ws.ping).toHaveBeenCalledTimes(2);
    });

    it('should NOT send ping when socket is not OPEN', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      // Simulate socket moving to CLOSING state
      ws.readyState = 2; // WebSocket.CLOSING
      ws.ping.mockClear();
      jest.advanceTimersByTime(30000);

      expect(ws.ping).not.toHaveBeenCalled();
    });

    it('should respond to ping even before authentication', async () => {
      // The gateway routes ping through handleControlMessage regardless of auth state
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      emitMessage(ws, { type: 'ping' });
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
    });
  });

  // -------------------------------------------------------------------------
  // connect message handling
  // -------------------------------------------------------------------------

  describe('connect message handling', () => {
    async function authenticateWs(ws: any): Promise<void> {
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();
      ws.send.mockClear();
    }

    it('should deny connect for unauthenticated client', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_fail', reason: 'Not authenticated' }),
      );
    });

    it('should send session_error when session is not found', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateWs(ws);

      sessionsService.findOne.mockRejectedValue(
        Object.assign(new Error('Not found'), { status: 404 }),
      );

      emitMessage(ws, { type: 'connect', sessionId: 'bad-id' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const sentCalls: string[] = ws.send.mock.calls.map((c: any[]) => c[0]);
      const sessionErrorCall = sentCalls.find((c) => c.includes('session_error'));
      expect(sessionErrorCall).toBeDefined();
    });

    it('should send session_error when session is terminated', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateWs(ws);

      sessionsService.findOne.mockResolvedValue({
        ...mockSession,
        status: 'terminated',
      } as any);

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'session_error', error: 'Session is terminated', code: 'TERMINATED' }),
      );
    });

    it('should attach immediately when session is already running', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateWs(ws);

      sessionsService.findOne.mockResolvedValue(mockSession as any);
      sessionManager.isSessionRunning.mockReturnValue(true);
      sessionManager.attachWebSocket.mockReturnValue(true);

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sessionManager.startSession).not.toHaveBeenCalled();
      expect(sessionManager.attachWebSocket).toHaveBeenCalledWith(SESSION_ID, ws);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'session_ready', sessionId: SESSION_ID }),
      );
    });

    it('should start session and update status when session is not yet running', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateWs(ws);

      sessionsService.findOne.mockResolvedValue(mockSession as any);
      sessionManager.isSessionRunning.mockReturnValue(false);
      serverProfilesService.getDecryptedProfile.mockResolvedValue(mockDecryptedProfile as any);
      sessionManager.attachWebSocket.mockReturnValue(true);

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      // Flush all async awaits in handleConnect:
      // findOne + getDecryptedProfile + startSession + updateStatus = 4 ticks
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(serverProfilesService.getDecryptedProfile).toHaveBeenCalledWith(
        mockSession.serverProfileId,
        VALID_USER_ID,
      );
      expect(sessionManager.startSession).toHaveBeenCalledWith(
        SESSION_ID,
        mockDecryptedProfile,
        mockSession.tmuxSessionId,
        mockSession.cols,
        mockSession.rows,
      );
      expect(sessionsService.updateStatus).toHaveBeenCalledWith(SESSION_ID, 'active');
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'session_ready', sessionId: SESSION_ID }),
      );
    });

    it('should send session_error with ATTACH_FAILED when attachWebSocket returns false', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateWs(ws);

      sessionsService.findOne.mockResolvedValue(mockSession as any);
      sessionManager.isSessionRunning.mockReturnValue(true);
      sessionManager.attachWebSocket.mockReturnValue(false);

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'session_error', error: 'Failed to attach', code: 'ATTACH_FAILED' }),
      );
    });

    it('should send session_error with CONNECTION_FAILED when startSession throws', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateWs(ws);

      sessionsService.findOne.mockResolvedValue(mockSession as any);
      sessionManager.isSessionRunning.mockReturnValue(false);
      serverProfilesService.getDecryptedProfile.mockResolvedValue(mockDecryptedProfile as any);
      sessionManager.startSession.mockRejectedValue(new Error('SSH refused'));

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'session_error', error: 'SSH refused', code: 'CONNECTION_FAILED' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Terminal input forwarding (binary messages)
  // -------------------------------------------------------------------------

  describe('binary input forwarding', () => {
    async function authenticateAndConnect(ws: any): Promise<void> {
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);
      sessionsService.findOne.mockResolvedValue(mockSession as any);
      sessionManager.isSessionRunning.mockReturnValue(true);
      sessionManager.attachWebSocket.mockReturnValue(true);

      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      ws.send.mockClear();

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      ws.send.mockClear();
    }

    it('should forward binary data to session manager when authenticated and connected', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateAndConnect(ws);

      const inputData = Buffer.from('ls -la\n');
      emitBinaryMessage(ws, inputData);
      await Promise.resolve();

      expect(sessionManager.sendInput).toHaveBeenCalledWith(SESSION_ID, inputData);
    });

    it('should not forward binary data when client is not authenticated', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      emitBinaryMessage(ws, Buffer.from('ls\n'));
      await Promise.resolve();

      expect(sessionManager.sendInput).not.toHaveBeenCalled();
    });

    it('should not forward binary data when authenticated but no session connected', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      emitBinaryMessage(ws, Buffer.from('ls\n'));
      await Promise.resolve();

      expect(sessionManager.sendInput).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Resize events
  // -------------------------------------------------------------------------

  describe('resize message handling', () => {
    async function authenticateAndConnect(ws: any): Promise<void> {
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);
      sessionsService.findOne.mockResolvedValue(mockSession as any);
      sessionManager.isSessionRunning.mockReturnValue(true);
      sessionManager.attachWebSocket.mockReturnValue(true);

      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    it('should call resizeSession with new dimensions', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);
      await authenticateAndConnect(ws);

      emitMessage(ws, { type: 'resize', cols: 120, rows: 40 });
      await Promise.resolve();

      expect(sessionManager.resizeSession).toHaveBeenCalledWith(SESSION_ID, 120, 40);
    });

    it('should ignore resize when client is not authenticated', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      emitMessage(ws, { type: 'resize', cols: 120, rows: 40 });
      await Promise.resolve();

      expect(sessionManager.resizeSession).not.toHaveBeenCalled();
    });

    it('should ignore resize when no session is connected', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      emitMessage(ws, { type: 'resize', cols: 120, rows: 40 });
      await Promise.resolve();

      expect(sessionManager.resizeSession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('should not crash when an unparseable message is received', async () => {
      const ws = createMockWebSocket();
      gateway.handleConnection(ws);

      // Emit a non-JSON buffer that looks like JSON (starts with '{') but is malformed
      ws.emit('message', Buffer.from('{not valid json'), false);
      await Promise.resolve();

      // Gateway should swallow the parse error gracefully
      expect(ws.close).not.toHaveBeenCalled();
    });

    it('should not crash when handleDisconnect is called for an unknown socket', () => {
      const ws = createMockWebSocket();
      expect(() => gateway.handleDisconnect(ws)).not.toThrow();
    });

    it('should not forward input when a message handler throws internally', async () => {
      const ws = createMockWebSocket();
      jwtService.verify.mockReturnValue({ sub: VALID_USER_ID });
      prisma.user.findUnique.mockResolvedValue(mockActiveUser);

      gateway.handleConnection(ws);
      emitMessage(ws, { type: 'auth', token: VALID_TOKEN });
      await Promise.resolve();
      await Promise.resolve();

      // Make findOne throw to simulate an unexpected error inside handleConnect
      sessionsService.findOne.mockRejectedValue(new Error('DB timeout'));

      emitMessage(ws, { type: 'connect', sessionId: SESSION_ID });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // The gateway catches and sends session_error, does not re-throw
      const calls: string[] = ws.send.mock.calls.map((c: any[]) => c[0]);
      const hasSessionError = calls.some((c) => c.includes('session_error'));
      expect(hasSessionError).toBe(true);
    });
  });
});
