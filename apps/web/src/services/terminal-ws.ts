import { api } from './api';
import { readHostKeyRefusal } from '../lib/terminal/host-key';

export type TerminalWsEventType =
  | 'data'
  | 'connect'
  | 'disconnect'
  | 'error'
  /** The server refused the principal: it lacks `sessions:write` (no reconnect). */
  | 'forbidden'
  /** The access token expired and could not be refreshed: sign in again (no reconnect). */
  | 'expired'
  /** A maintenance window is open: no new terminal session may start (no reconnect, #46). */
  | 'maintenance'
  /**
   * The server's host key is unknown or changed (#60): the payload is a
   * `HostKeyRefusal`. The socket stays open; `retryConnect()` asks again once
   * the user trusted the key.
   */
  | 'host_key';

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

/**
 * The longest lead before the token's `exp` at which the socket asks for a
 * fresh one. A short-lived token gets a proportionally shorter lead
 * ({@link REFRESH_LEAD_FRACTION}), so a token living a minute or less is not
 * refreshed the moment it arrives (issue #93).
 */
export const REFRESH_LEAD_MS = 60_000;
/** The share of a token's lifetime used as the lead when that is under {@link REFRESH_LEAD_MS}. */
export const REFRESH_LEAD_FRACTION = 0.2;
/**
 * The shortest time between two refreshes this socket asks for, whatever the
 * token's claims say (a skewed clock, a server issuing very short tokens), so
 * the refresh endpoint is never hammered.
 */
export const MIN_REFRESH_INTERVAL_MS = 10_000;

/**
 * How long to wait before refreshing a token, from its claims and the time of
 * the last refresh (issue #93). The lead is `min(REFRESH_LEAD_MS, 20% of the
 * token's lifetime)`; the lifetime is `exp - iat` when the token carries `iat`
 * (both on the server's clock, so local clock skew does not shrink it), else
 * the time left. The result never schedules a refresh sooner than
 * {@link MIN_REFRESH_INTERVAL_MS} after the previous one.
 *
 * @param expiresAt - the token's `exp`, epoch ms.
 * @param issuedAt - the token's `iat`, epoch ms, or `null`.
 * @param now - the current time, epoch ms.
 * @param lastRefreshAt - when the last refresh completed, epoch ms, or `null`.
 * @returns the delay in ms (never negative).
 */
export function refreshDelayMs(
  expiresAt: number,
  issuedAt: number | null,
  now: number,
  lastRefreshAt: number | null,
): number {
  const remaining = expiresAt - now;
  const lifetime = issuedAt !== null && expiresAt > issuedAt ? expiresAt - issuedAt : remaining;
  const lead = Math.min(REFRESH_LEAD_MS, Math.max(0, lifetime) * REFRESH_LEAD_FRACTION);
  const earliest = lastRefreshAt === null ? 0 : lastRefreshAt + MIN_REFRESH_INTERVAL_MS - now;
  return Math.max(remaining - lead, earliest, 0);
}

export const FORBIDDEN_MESSAGE =
  'Your role can view sessions but not open a terminal. Ask an administrator for terminal access.';
export const EXPIRED_MESSAGE = 'Your session has expired. Sign in again to reconnect.';
/**
 * Shown when the gateway refuses a new `auth` or `connect` with
 * `{ type: 'auth_fail', reason: 'maintenance' }` (#46). The window is planned and
 * reconnecting would only be refused again, so the socket stops; the alert
 * offers a manual retry.
 */
export const MAINTENANCE_MESSAGE =
  'ShellKeep is in maintenance. New terminal sessions are paused; try again later.';
/** Shown after the user declined to trust an unknown host key (#60). */
export const HOST_KEY_UNTRUSTED_MESSAGE =
  'The server\'s host key is not trusted, so the connection was not opened.';
/** Shown after the user cancelled on a changed host key (#60). */
export const HOST_KEY_MISMATCH_MESSAGE =
  'The server\'s host key changed, so the connection was refused. Nothing was sent.';

/** The `reason` of the gateway's maintenance refusal (`TERMINAL_MAINTENANCE_REASON`). */
export const MAINTENANCE_REASON = 'maintenance';

/** The numeric claims of a JWT payload, or `null` when the token is not a readable JWT. */
function readClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as unknown;
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The `exp` claim of a JWT, in epoch milliseconds, or `null` when the token is
 * not a readable JWT. The signature is not checked: the server does that; this
 * only schedules the client's own refresh.
 */
export function tokenExpiryMs(token: string): number | null {
  const exp = readClaims(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

/** The `iat` claim of a JWT, in epoch milliseconds, or `null` when absent or unreadable. */
export function tokenIssuedAtMs(token: string): number | null {
  const iat = readClaims(token)?.iat;
  return typeof iat === 'number' ? iat * 1000 : null;
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
  /** When the last refresh this socket saw completed (its own or anyone's), epoch ms. */
  private lastRefreshAt: number | null = null;
  /** The refresh this socket is waiting on: concurrent callers share it (issue #93). */
  private refreshInFlight: Promise<boolean> | null = null;
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
        } else if (message.reason === MAINTENANCE_REASON) {
          // A planned window, not a broken connection: stop here (no reconnect
          // loop). On a refused `connect` the server keeps the socket open; it
          // is closed here all the same, so a retry starts from a fresh one.
          this.emit('maintenance', null);
          this.emit('error', new Error(MAINTENANCE_MESSAGE));
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
      case 'session_error': {
        // A host-key refusal (#60): the socket stays open and no credential was
        // sent. The view prompts; after trust it calls `retryConnect()`.
        const refusal = readHostKeyRefusal(message);
        if (refusal) {
          this.emit('host_key', refusal);
          break;
        }
        this.emit(
          'error',
          new Error(
            message.error ||
              message.message ||
              (message.code === 'NOT_FOUND' ? 'Session not found' : 'Session error'),
          ),
        );
        break;
      }
      case 'session_ended':
        this._connected = false;
        this.emit('disconnect', message.reason);
        break;
      case 'pong':
        // Heartbeat response, no action needed
        break;
    }
  }

  /**
   * Ask for the session again on the open, authenticated socket (after the
   * user trusted a host key, #60), or open a fresh socket when that one is gone.
   */
  retryConnect(): void {
    if (this.ws && this.authenticated && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'connect', sessionId: this.sessionId }));
      return;
    }
    const old = this.ws;
    this.ws = null; // its close event must not schedule a reconnect
    old?.close();
    this.reconnectAttempts = 0;
    this.connect();
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
      this.lastRefreshAt = Date.now();
      if (this.ws && this.authenticated && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'auth', token }));
      }
    });
  }

  /**
   * Refresh shortly before the current token's `exp`, so the gateway never sees
   * it lapse. The lead scales with the token's lifetime and refreshes are at
   * least {@link MIN_REFRESH_INTERVAL_MS} apart ({@link refreshDelayMs}).
   */
  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    const token = this.auth.getAccessToken();
    const expiresAt = token ? tokenExpiryMs(token) : null;
    if (!token || expiresAt === null) return; // `auth_expired` recovery still covers it
    const delay = refreshDelayMs(expiresAt, tokenIssuedAtMs(token), Date.now(), this.lastRefreshAt);
    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = null;
      // Someone else refreshed meanwhile: plan from the token held now instead of
      // refreshing a token that was just issued. (Its `auth_refreshed` reschedules too.)
      if (this.auth.getAccessToken() !== token) {
        this.scheduleRefresh();
        return;
      }
      // A successful refresh fires the listener above, which re-sends `auth`.
      void this.refresh();
    }, delay);
  }

  /** Refresh the access token; concurrent callers share one in-flight request. */
  private refresh(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.auth
        .refreshAccessToken()
        .catch(() => false)
        .then((refreshed) => {
          if (refreshed) this.lastRefreshAt = Date.now();
          return refreshed;
        })
        .finally(() => {
          this.refreshInFlight = null;
        });
    }
    return this.refreshInFlight;
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
    const refreshed = await this.refresh();
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
