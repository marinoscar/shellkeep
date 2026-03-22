import { Logger } from '@nestjs/common';
import { WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ServerProfilesService } from '../server-profiles/server-profiles.service';
import { SessionsService } from './sessions.service';
import { SessionManagerService } from './session-manager.service';
import WebSocket from 'ws';

interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  sessionId?: string;
  authenticated: boolean;
  authTimeout?: NodeJS.Timeout;
  pingInterval?: NodeJS.Timeout;
}

@WebSocketGateway({ path: '/api/terminal/ws' })
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly clients = new Map<WebSocket, AuthenticatedClient>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly serverProfilesService: ServerProfilesService,
    private readonly sessionsService: SessionsService,
    private readonly sessionManager: SessionManagerService,
  ) {}

  handleConnection(client: WebSocket): void {
    this.logger.log('New WebSocket connection');

    const clientState: AuthenticatedClient = {
      ws: client,
      userId: '',
      authenticated: false,
    };

    // Set auth timeout - must authenticate within 5 seconds
    clientState.authTimeout = setTimeout(() => {
      if (!clientState.authenticated) {
        this.logger.warn('Auth timeout, closing connection');
        client.send(JSON.stringify({ type: 'auth_fail', reason: 'Authentication timeout' }));
        client.close();
      }
    }, 5000);

    this.clients.set(client, clientState);

    // Handle messages
    client.on('message', async (data: Buffer | string, isBinary: boolean) => {
      try {
        if (isBinary || (data instanceof Buffer && !this.isJsonMessage(data))) {
          // Binary data = terminal input
          if (clientState.authenticated && clientState.sessionId) {
            this.sessionManager.sendInput(clientState.sessionId, Buffer.isBuffer(data) ? data : Buffer.from(data));
          }
          return;
        }

        // Text message = control message
        const message = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
        await this.handleControlMessage(client, clientState, message);
      } catch (err) {
        this.logger.error(`Message handling error: ${(err as Error).message}`);
      }
    });
  }

  handleDisconnect(client: WebSocket): void {
    const clientState = this.clients.get(client);
    if (clientState) {
      if (clientState.authTimeout) clearTimeout(clientState.authTimeout);
      if (clientState.pingInterval) clearInterval(clientState.pingInterval);
      this.clients.delete(client);
      this.logger.log(`WebSocket disconnected (userId: ${clientState.userId || 'unauthenticated'})`);
    }
  }

  private async handleControlMessage(
    client: WebSocket,
    clientState: AuthenticatedClient,
    message: any,
  ): Promise<void> {
    switch (message.type) {
      case 'auth':
        await this.handleAuth(client, clientState, message.token);
        break;

      case 'connect':
        if (!clientState.authenticated) {
          client.send(JSON.stringify({ type: 'auth_fail', reason: 'Not authenticated' }));
          return;
        }
        await this.handleConnect(client, clientState, message.sessionId);
        break;

      case 'resize':
        if (clientState.authenticated && clientState.sessionId) {
          this.sessionManager.resizeSession(clientState.sessionId, message.cols, message.rows);
        }
        break;

      case 'ping':
        client.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  private async handleAuth(client: WebSocket, clientState: AuthenticatedClient, token: string): Promise<void> {
    try {
      const payload = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

      if (!user || !user.isActive) {
        client.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid user' }));
        client.close();
        return;
      }

      clientState.userId = user.id;
      clientState.authenticated = true;
      if (clientState.authTimeout) {
        clearTimeout(clientState.authTimeout);
        clientState.authTimeout = undefined;
      }

      // Start ping/pong heartbeat
      clientState.pingInterval = setInterval(() => {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }, 30000);

      client.send(JSON.stringify({ type: 'auth_ok' }));
      this.logger.log(`WebSocket authenticated for user ${user.id}`);
    } catch (err) {
      client.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid token' }));
      client.close();
    }
  }

  private async handleConnect(
    client: WebSocket,
    clientState: AuthenticatedClient,
    sessionId: string,
  ): Promise<void> {
    try {
      // Verify session ownership
      const session = await this.sessionsService.findOne(sessionId, clientState.userId);
      if (!session) {
        client.send(JSON.stringify({ type: 'session_error', error: 'Session not found', code: 'NOT_FOUND' }));
        return;
      }

      if (session.status === 'terminated') {
        client.send(JSON.stringify({ type: 'session_error', error: 'Session is terminated', code: 'TERMINATED' }));
        return;
      }

      // Start or reattach session
      if (!this.sessionManager.isSessionRunning(sessionId)) {
        // Need to start SSH connection
        const profile = await this.serverProfilesService.getDecryptedProfile(
          session.serverProfileId,
          clientState.userId,
        );

        await this.sessionManager.startSession(
          sessionId,
          profile,
          session.tmuxSessionId,
          session.cols,
          session.rows,
        );

        // Update status to active
        await this.sessionsService.updateStatus(sessionId, 'active');
      }

      // Attach this WebSocket to the session
      const attached = this.sessionManager.attachWebSocket(sessionId, client);
      if (!attached) {
        client.send(JSON.stringify({ type: 'session_error', error: 'Failed to attach', code: 'ATTACH_FAILED' }));
        return;
      }

      clientState.sessionId = sessionId;
      client.send(JSON.stringify({ type: 'session_ready', sessionId }));
      this.logger.log(`WebSocket attached to session ${sessionId}`);
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.logger.error(`Session connect error: ${errorMsg}`);
      client.send(JSON.stringify({ type: 'session_error', error: errorMsg, code: 'CONNECTION_FAILED' }));
    }
  }

  private isJsonMessage(data: Buffer): boolean {
    // Simple heuristic: if it starts with '{', it's likely JSON
    return data.length > 0 && data[0] === 0x7b; // '{'
  }
}
