import { ForbiddenException, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OnEvent } from '@nestjs/event-emitter';
import { SHARING_EVENTS, type GrantEventPayload, type GroupEventPayload, type GroupMemberEventPayload } from '@marinoscar/platform-api/sharing';
import { SERVER_PROFILE_RESOURCE } from '../app-registrations/sharing';
import { WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { ServerProfilesService } from '../server-profiles/server-profiles.service';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { actingPrincipal } from '../platform/sharing/sharing-access';
import type { OwnerScope } from '../common/types/owner-scope';
import { SessionsService } from './sessions.service';
import { SessionManagerService } from './session-manager.service';
import { TerminalPrincipalResolver } from './ws/terminal-principal.resolver';
import { TERMINAL_MAINTENANCE_REASON, TerminalMaintenancePolicy } from './ws/terminal-maintenance.policy';
import { HostKeyError } from '../ssh/host-key.error';
import { TerminalMetricsService } from './telemetry/terminal-metrics.service';
import type { WsAuthDeniedReason } from './telemetry/terminal.metrics';
import * as WebSocket from 'ws';

/** setTimeout cannot hold a delay above 2^31 - 1 ms (about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  orgId: string;
  permissions: readonly string[];
  roles: readonly string[];
  sessionId?: string;
  /** The server profile of the attached session, for the share re-check. */
  serverProfileId?: string;
  authenticated: boolean;
  authTimeout?: NodeJS.Timeout;
  pingInterval?: NodeJS.Timeout;
  /** Closes the socket with `auth_expired` when the access token expires. */
  expiryTimeout?: NodeJS.Timeout;
  expiresAtMs: number;
  /** The `terminal.ws.session` span: the lifetime of the socket's attachment to a session. */
  sessionSpan?: Span;
}

const tracer = trace.getTracer('shellkeep.terminal');

@WebSocketGateway({ path: '/api/terminal/ws' })
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly clients = new Map<WebSocket, AuthenticatedClient>();

  constructor(
    private readonly principals: TerminalPrincipalResolver,
    private readonly serverProfilesService: ServerProfilesService,
    private readonly sessionsService: SessionsService,
    private readonly sessionManager: SessionManagerService,
    private readonly maintenance: TerminalMaintenancePolicy,
    @Optional() private readonly metrics?: TerminalMetricsService,
  ) {}

  onModuleInit(): void {
    // The `app.terminal.ws.connections` gauge: authenticated sockets held by THIS process.
    this.metrics?.bindWsConnections(() => this.authenticatedCount());
  }

  /** Authenticated sockets in this process. */
  authenticatedCount(): number {
    let count = 0;
    for (const state of this.clients.values()) if (state.authenticated) count += 1;
    return count;
  }

  handleConnection(client: WebSocket): void {
    this.logger.log('New WebSocket connection');

    const clientState: AuthenticatedClient = {
      ws: client,
      userId: '',
      orgId: '',
      permissions: [],
      roles: [],
      expiresAtMs: 0,
      authenticated: false,
    };

    // Set auth timeout - must authenticate within 5 seconds
    clientState.authTimeout = setTimeout(() => {
      if (!clientState.authenticated) {
        this.logger.warn('Auth timeout, closing connection');
        this.metrics?.authDenied('timeout');
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
          if (this.isLive(client, clientState) && clientState.sessionId) {
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
      if (clientState.expiryTimeout) clearTimeout(clientState.expiryTimeout);
      this.endSessionSpan(clientState);
      this.clients.delete(client);
      this.logger.log(`WebSocket disconnected (userId: ${clientState.userId || 'unauthenticated'})`);
    }
  }

  /**
   * A share changed (#145): re-check every attached client the event can touch with the rule
   * `connect` uses, and detach one that may no longer connect. Never throws.
   */
  @OnEvent(SHARING_EVENTS.GRANT_REVOKED)
  @OnEvent(SHARING_EVENTS.GRANT_UPDATED)
  async onGrantChanged(event: GrantEventPayload): Promise<void> {
    if (event?.resourceType !== SERVER_PROFILE_RESOURCE) return;
    await this.recheckAttached((c) => c.orgId === event.orgId && c.serverProfileId === event.resourceId);
  }

  @OnEvent(SHARING_EVENTS.MEMBER_REMOVED)
  async onMemberRemoved(event: GroupMemberEventPayload): Promise<void> {
    await this.recheckAttached((c) => c.orgId === event.orgId && c.userId === event.userId);
  }

  @OnEvent(SHARING_EVENTS.GROUP_DELETED)
  async onGroupDeleted(event: GroupEventPayload): Promise<void> {
    await this.recheckAttached((c) => c.orgId === event.orgId);
  }

  private async recheckAttached(affected: (c: AuthenticatedClient) => boolean): Promise<void> {
    try {
      const targets = [...this.clients.values()].filter(
        (c) => c.authenticated && c.sessionId && c.serverProfileId && affected(c),
      );
      for (const state of targets) {
        try {
          await this.recheckClient(state);
        } catch (err) {
          this.logger.error(`Share re-check failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Share re-check failed: ${(err as Error).message}`);
    }
  }

  private async recheckClient(state: AuthenticatedClient): Promise<void> {
    const { sessionId, serverProfileId } = state;
    if (!sessionId || !serverProfileId) return;
    const principal = actingPrincipal({
      userId: state.userId,
      orgId: state.orgId,
      permissions: state.permissions,
      roles: state.roles,
    });
    try {
      await this.serverProfilesService.assertCanConnect(serverProfileId, principal);
      return;
    } catch (err) {
      // Only a refusal detaches; an unexpected error leaves the client attached (and is logged above).
      if (!(err instanceof NotFoundException || err instanceof ForbiddenException)) throw err;
    }
    // The client may have moved on while the check ran.
    if (state.sessionId !== sessionId) return;
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'session_ended', reason: 'access_revoked' }));
    }
    this.sessionManager.detachWebSocket(sessionId, state.ws);
    state.sessionId = undefined;
    state.serverProfileId = undefined;
    this.endSessionSpan(state);
    this.logger.log(`Detached a client from session ${sessionId}: access revoked`);
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
        if (!this.isLive(client, clientState)) {
          client.send(JSON.stringify({ type: 'auth_fail', reason: 'Not authenticated' }));
          return;
        }
        if (await this.maintenance.refuses({ userId: clientState.userId, roles: clientState.roles })) {
          // A window is open: no NEW session starts or attaches. The socket itself is left
          // alone (it may be streaming another session), and the client shows a banner.
          this.logger.warn(`ws.connect.refused userId=${clientState.userId} reason=${TERMINAL_MAINTENANCE_REASON}`);
          client.send(JSON.stringify({ type: 'auth_fail', reason: TERMINAL_MAINTENANCE_REASON }));
          return;
        }
        await this.handleConnect(client, clientState, message.sessionId);
        break;

      case 'resize':
        if (this.isLive(client, clientState) && clientState.sessionId) {
          this.sessionManager.resizeSession(clientState.sessionId, message.cols, message.rows);
        }
        break;

      case 'ping':
        client.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  /**
   * Authenticates the socket, or, when it already is authenticated, replaces its
   * token (the client re-sends `auth` after each access-token refresh so an open
   * terminal outlives the 15-minute token).
   *
   * Refused with `auth_fail` and a close: an invalid token, an inactive user, a
   * principal without `sessions:write` (`reason: 'forbidden'`: a Viewer may list
   * sessions over HTTP but never type into one), and a re-auth as a different
   * user or organization. The token is read only from this first-class message,
   * never from a query string, and is never logged.
   */
  private async handleAuth(client: WebSocket, clientState: AuthenticatedClient, token: unknown): Promise<void> {
    let result;
    try {
      result = await this.principals.resolve(token);
    } catch (err) {
      this.logger.error(`Principal resolution failed: ${(err as Error).message}`);
      this.denyAuth(client, clientState, 'Invalid token', 'invalid_token', undefined, 'invalid_token');
      return;
    }

    if (!result.ok) {
      this.denyAuth(
        client,
        clientState,
        result.reason === 'invalid_user' ? 'Invalid user' : 'Invalid token',
        result.reason,
        undefined,
        // An inactive user or one with no organization is refused as `forbidden`; an expired token
        // is told apart from a malformed or forged one.
        result.reason === 'invalid_user' ? 'forbidden' : result.reason,
      );
      return;
    }

    const { principal } = result;

    if (!principal.permissions.includes(PERMISSIONS.SESSIONS_WRITE)) {
      this.denyAuth(client, clientState, 'forbidden', 'forbidden', principal.userId, 'forbidden');
      return;
    }

    const reauth = clientState.authenticated;

    // Maintenance mode (#46): a NEW authentication is refused while a window is open, with
    // the platform's exemptions (an administrator when `allowAdmins`, a registered bypass).
    // A token refresh on an already authenticated socket is never refused, so a window does
    // not cut off a terminal that is already open.
    if (!reauth && (await this.maintenance.refuses({ userId: principal.userId, roles: principal.roles }))) {
      this.denyAuth(
        client,
        clientState,
        TERMINAL_MAINTENANCE_REASON,
        TERMINAL_MAINTENANCE_REASON,
        principal.userId,
        'maintenance',
      );
      return;
    }

    if (reauth && (principal.userId !== clientState.userId || principal.orgId !== clientState.orgId)) {
      this.denyAuth(client, clientState, 'forbidden', 'identity_changed', principal.userId, 'forbidden');
      return;
    }

    clientState.userId = principal.userId;
    clientState.orgId = principal.orgId;
    clientState.permissions = principal.permissions;
    clientState.roles = principal.roles;
    clientState.expiresAtMs = principal.expiresAtMs;
    clientState.authenticated = true;
    this.scheduleExpiry(client, clientState);

    if (clientState.authTimeout) {
      clearTimeout(clientState.authTimeout);
      clientState.authTimeout = undefined;
    }

    if (reauth) {
      client.send(JSON.stringify({ type: 'auth_refreshed' }));
      this.logger.log(`WebSocket token refreshed for user ${principal.userId}`);
      return;
    }

    // Start ping/pong heartbeat
    clientState.pingInterval = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }, 30000);

    client.send(JSON.stringify({ type: 'auth_ok' }));
    this.logger.log(`WebSocket authenticated for user ${principal.userId}`);
  }

  /**
   * Refuses an authentication attempt: count it (`metricReason`, a bounded value, never an id), log
   * the denial (never the token), tell the client, close.
   */
  private denyAuth(
    client: WebSocket,
    clientState: AuthenticatedClient,
    reason: string,
    logReason: string,
    userId: string | undefined,
    metricReason: WsAuthDeniedReason,
  ): void {
    this.metrics?.authDenied(metricReason);
    this.logger.warn(
      `ws.auth.denied userId=${userId ?? (clientState.userId || 'unknown')} reason=${logReason}`,
    );
    client.send(JSON.stringify({ type: 'auth_fail', reason }));
    client.close();
  }

  /** Arms (or re-arms) the timer that ends the connection when the access token expires. */
  private scheduleExpiry(client: WebSocket, clientState: AuthenticatedClient): void {
    if (clientState.expiryTimeout) clearTimeout(clientState.expiryTimeout);
    const delay = Math.min(Math.max(clientState.expiresAtMs - Date.now(), 0), MAX_TIMER_MS);
    clientState.expiryTimeout = setTimeout(() => this.expire(client, clientState), delay);
  }

  /** The access token expired and no fresh one arrived: tell the client and close. */
  private expire(client: WebSocket, clientState: AuthenticatedClient): void {
    if (!clientState.authenticated) return;
    clientState.authenticated = false;
    this.metrics?.authDenied('expired');
    this.logger.log(`WebSocket token expired for user ${clientState.userId}`);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'auth_expired' }));
    }
    client.close();
  }

  /** Authenticated, holding the terminal permission, and not past the token's expiry. */
  private isLive(client: WebSocket, clientState: AuthenticatedClient): boolean {
    if (!clientState.authenticated) return false;
    if (Date.now() >= clientState.expiresAtMs) {
      this.expire(client, clientState);
      return false;
    }
    return clientState.permissions.includes(PERMISSIONS.SESSIONS_WRITE);
  }

  private async handleConnect(
    client: WebSocket,
    clientState: AuthenticatedClient,
    sessionId: unknown,
  ): Promise<void> {
    try {
      // Never trust a client-supplied id: it must be a UUID of a session owned by
      // this user in this organization, or the answer is NOT_FOUND (also for
      // another user's session, so existence is not disclosed).
      if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
        client.send(JSON.stringify({ type: 'session_error', error: 'Session not found', code: 'NOT_FOUND' }));
        return;
      }

      const scope: OwnerScope = { userId: clientState.userId, orgId: clientState.orgId };
      let session;
      try {
        session = await this.sessionsService.findOne(sessionId, scope);
      } catch (err) {
        if (err instanceof NotFoundException) {
          client.send(JSON.stringify({ type: 'session_error', error: 'Session not found', code: 'NOT_FOUND' }));
          return;
        }
        throw err;
      }

      if (session.status === 'terminated') {
        client.send(JSON.stringify({ type: 'session_error', error: 'Session is terminated', code: 'TERMINATED' }));
        return;
      }

      // The session is the caller's own, but attaching to it (or starting it) needs the right to
      // connect to its server NOW: a share that was revoked since the session was created closes the
      // door, for a session already running as well (404 NOT_FOUND, nothing disclosed).
      const principal = actingPrincipal({
        userId: clientState.userId,
        orgId: clientState.orgId,
        permissions: clientState.permissions,
        roles: clientState.roles,
      });
      try {
        await this.serverProfilesService.assertCanConnect(session.serverProfileId, principal);
      } catch (err) {
        if (err instanceof NotFoundException || err instanceof ForbiddenException) {
          client.send(JSON.stringify({ type: 'session_error', error: 'Session not found', code: 'NOT_FOUND' }));
          return;
        }
        throw err;
      }

      // Start or reattach session
      if (!this.sessionManager.isSessionRunning(sessionId)) {
        // Need to start SSH connection
        const profile = await this.serverProfilesService.getDecryptedProfile(
          session.serverProfileId,
          principal,
          'connect',
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
      clientState.serverProfileId = session.serverProfileId;
      this.startSessionSpan(clientState, sessionId);
      client.send(JSON.stringify({ type: 'session_ready', sessionId }));
      this.logger.log(`WebSocket attached to session ${sessionId}`);
    } catch (err) {
      if (err instanceof HostKeyError) {
        // Refused before any credential was sent. The client shows the fingerprints and asks
        // the user to trust the key (UNKNOWN) or warns of a possible interception (MISMATCH).
        this.logger.warn(`Session connect refused: ${err.code} profile=${err.serverProfileId ?? 'unknown'}`);
        client.send(
          JSON.stringify({
            type: 'session_error',
            error: err.message,
            code: err.code,
            presented: err.presented,
            expected: err.expected ?? null,
            serverProfileId: err.serverProfileId ?? null,
          }),
        );
        return;
      }
      const errorMsg = (err as Error).message;
      this.logger.error(`Session connect error: ${errorMsg}`);
      client.send(JSON.stringify({ type: 'session_error', error: errorMsg, code: 'CONNECTION_FAILED' }));
    }
  }

  /**
   * `terminal.ws.session`: the lifetime of the socket's attachment to a session, ended when the
   * socket closes (or attaches elsewhere). The ids live on the span only, never on a metric.
   */
  private startSessionSpan(clientState: AuthenticatedClient, sessionId: string): void {
    this.endSessionSpan(clientState);
    clientState.sessionSpan = tracer.startSpan('terminal.ws.session', {
      attributes: { 'session.id': sessionId, 'org.id': clientState.orgId },
    });
  }

  private endSessionSpan(clientState: AuthenticatedClient): void {
    const span = clientState.sessionSpan;
    if (!span) return;
    clientState.sessionSpan = undefined;
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  private isJsonMessage(data: Buffer): boolean {
    // Simple heuristic: if it starts with '{', it's likely JSON
    return data.length > 0 && data[0] === 0x7b; // '{'
  }
}
