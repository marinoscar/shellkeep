import { api } from './api';

export type TerminalWsEventType =
  | 'data'
  | 'connect'
  | 'disconnect'
  | 'error'
  /** The server refused the principal: it lacks `sessions:write` (no reconnect). */
  | 'forbidden'
  /** The access token expired and could not be refreshed: sign in again (no reconnect). */
  | 'expired';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- listeners receive differently shaped payloads per event
type Listener = (...args: any[]) => void;

/**
 * Where the socket gets its access token (issue #47). The gateway only accepts
 * the token in-band, in an `auth` message, and closes the socket with
 * `auth_expired` when that token's `exp` passes, so the socket must present a
 * fresh one after every refresh.
 */
export interface TerminalAuth {
  /** The access token held right now, or `null` when signed out. */
  getAccessToken(): string | null;
  /** Refresh the access token from the refresh cookie; `true` when a new one is held. */
  refreshAccessToken(): Promise<boolean>;
  /** Subscribe to "a new access token is held"; returns the unsubscribe. */
  onAccessTokenRefreshed(listener: (token: string) => void): () => void;
}

/** The app's session: the identity slice's HTTP client (`services/api.ts`). */
export const appTerminalAuth: TerminalAuth = {
  getAccessToken: () => api.getAccessToken(),
  refreshAccessToken: () => api.refreshToken(),
  onAccessTokenRefreshed: (listener) => api.onAccessTokenRefreshed(listener),
};

/** A fixed token that is never refreshed (tests, one-off tools). */
export function staticTerminalAuth(token: string): TerminalAuth {
  return {
    getAccessToken: () => token,
    refreshAccessToken: () => Promise.resolve(false),
    onAccessTokenRefreshed: () => () => undefined,
  };
}

/** How long before the token's `exp` the socket asks for a fresh one. */
export const REFRESH_LEAD_MS = 60_000;
/** The earliest a proactive refresh runs, so an almost-expired token is not hammered. */
const MIN_REFRESH_DELAY_MS = 1_000;

export const FORBIDDEN_MESSAGE =
  'Your role can view sessions but not open a terminal. Ask an administrator for terminal access.';
export const EXPIRED_MESSAGE = 'Your session has expired. Sign in again to reconnect.';

/**
 * The `exp` claim of a JWT, in epoch milliseconds, or `null` when the token is
 * not a readable JWT. The signature is not checked: the server does that; this
 * only schedules the client's own refresh.
 */
export function tokenExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export class TerminalWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: Map<TerminalWsEventType, Set<Listener>> = new Map();
  private _connected = false;
  /** The gateway accepted a token on the current socket. */
  private authenticated = false;
  /** An `auth_expired` is being recovered from: the close it precedes must not reconnect. */
  private recoveringFromExpiry = false;
  /** The one refresh-and-reconnect an expiry gets was used and has not yet succeeded. */
  private expiryRetryUsed = false;
  /** Set by `disconnect()`: nothing may reopen the socket. */
  private stopped = false;
  private unsubscribeRefresh: (() => void) | null = null;
  private readonly auth: TerminalAuth;

  /**
   * @param sessionId - the terminal session to attach to.
   * @param auth - where the access token comes from; a string is a fixed token
   *   that is never refreshed. Defaults to the app's session.
   */
  constructor(
    private sessionId: string,
    auth: TerminalAuth | string = appTerminalAuth,
  ) {
    this.auth = typeof auth === 'string' ? staticTerminalAuth(auth) : auth;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.stopped = false;
    this.subscribeToRefresh();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/terminal/ws`;

    const ws = new WebSocket(url);
    this.ws = ws;
    this.authenticated = false;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const token = this.auth.getAccessToken();
      if (!token) {
        this.failExpired();
        return;
      }
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary data = terminal output
        this.emit('data', new Uint8Array(event.data));
        return;
      }

      // Text data = control message
      let message: { type?: string; reason?: string; error?: string; message?: string; code?: string };
      try {
        message = JSON.parse(event.data);
      } catch {
        // If parse fails, treat as terminal output
        const encoder = new TextEncoder();
        this.emit('data', encoder.encode(event.data));
        return;
      }
      this.handleControl(ws, message);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // a socket replaced on purpose
      this._connected = false;
      this.authenticated = false;
      this.stopPing();
      this.clearRefreshTimer();
      this.emit('disconnect', 'connection_closed');
      if (!this.recoveringFromExpiry) this.attemptReconnect();
    };

    ws.onerror = () => {
      this.emit('error', new Error('WebSocket error'));
    };
  }

  private handleControl(
    ws: WebSocket,
    message: { type?: string; reason?: string; error?: string; message?: string; code?: string },
  ): void {
    switch (message.type) {
      case 'auth_ok':
        this.authenticated = true;
        this.scheduleRefresh();
        // Now connect to session
        ws.send(JSON.stringify({ type: 'connect', sessionId: this.sessionId }));
        break;
      case 'auth_refreshed':
        // The socket now runs on the token sent last: plan the next refresh. No `connect`.
        this.scheduleRefresh();
        break;
      case 'auth_fail':
        if (message.reason === 'forbidden') {
          this.emit('forbidden', null);
          this.emit('error', new Error(FORBIDDEN_MESSAGE));
        } else {
          this.emit('error', new Error(message.reason || 'Authentication failed'));
        }
        this.disconnect();
        break;
      case 'auth_expired':
        void this.recoverFromExpiry();
        break;
      case 'session_ready':
        this._connected = true;
        this.reconnectAttempts = 0;
        this.expiryRetryUsed = false;
        this.startPing();
        this.emit('connect', null);
        break;
      case 'session_error':
        this.emit(
          'error',
          new Error(
            message.error ||
              message.message ||
              (message.code === 'NOT_FOUND' ? 'Session not found' : 'Session error'),
          ),
        );
        break;
      case 'session_ended':
        this._connected = false;
        this.emit('disconnect', message.reason);
        break;
      case 'pong':
        // Heartbeat response, no action needed
        break;
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
    this.recoveringFromExpiry = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearRefreshTimer();
    this.unsubscribeRefresh?.();
    this.unsubscribeRefresh = null;
    this.stopPing();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    this._connected = false;
    this.authenticated = false;
  }

  send(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  on(event: TerminalWsEventType, callback: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: TerminalWsEventType, callback: Listener): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: TerminalWsEventType, data: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  /**
   * Present every fresh access token on the open socket, whoever refreshed it
   * (this socket's own timer, a 401-retry of an HTTP call, another terminal).
   */
  private subscribeToRefresh(): void {
    if (this.unsubscribeRefresh) return;
    this.unsubscribeRefresh = this.auth.onAccessTokenRefreshed((token) => {
      if (this.ws && this.authenticated && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'auth', token }));
      }
    });
  }

  /** Refresh shortly before the current token's `exp`, so the gateway never sees it lapse. */
  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    const token = this.auth.getAccessToken();
    const expiresAt = token ? tokenExpiryMs(token) : null;
    if (expiresAt === null) return; // `auth_expired` recovery still covers it
    const delay = Math.max(expiresAt - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = null;
      // A successful refresh fires the listener above, which re-sends `auth`.
      void this.auth.refreshAccessToken().catch(() => false);
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  /**
   * The gateway closes the socket after `auth_expired`. Try one refresh and
   * reconnect with the new token; when that fails (or an expiry repeats before
   * a session is ready again) stop and tell the user to sign in again.
   */
  private async recoverFromExpiry(): Promise<void> {
    this.recoveringFromExpiry = true;
    this.clearRefreshTimer();
    if (this.expiryRetryUsed) {
      this.failExpired();
      return;
    }
    this.expiryRetryUsed = true;
    const refreshed = await this.auth.refreshAccessToken().catch(() => false);
    if (this.stopped) return;
    if (!refreshed) {
      this.failExpired();
      return;
    }
    this.recoveringFromExpiry = false;
    this.reconnectAttempts = 0;
    const old = this.ws;
    this.ws = null; // its close event must not schedule a second reconnect
    this.stopPing();
    this._connected = false;
    old?.close();
    this.connect();
  }

  private failExpired(): void {
    this.emit('expired', null);
    this.emit('error', new Error(EXPIRED_MESSAGE));
    this.disconnect();
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.stopped || this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }
}
