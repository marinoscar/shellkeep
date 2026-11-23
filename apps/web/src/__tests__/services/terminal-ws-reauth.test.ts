import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TerminalWebSocket,
  EXPIRED_MESSAGE,
  FORBIDDEN_MESSAGE,
  MIN_REFRESH_INTERVAL_MS,
  REFRESH_LEAD_MS,
  refreshDelayMs,
  tokenExpiryMs,
  tokenIssuedAtMs,
  type TerminalAuth,
} from '../../services/terminal-ws';

/**
 * Issue #47: the gateway closes the socket with `auth_expired` at the access
 * token's `exp` unless the client presents a fresh token in-band; it refuses a
 * principal without `sessions:write` with `auth_fail` `forbidden`.
 */

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  binaryType = 'blob';
  readyState = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.(new Event('open'));
  }
  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
  serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
  sent(): unknown[] {
    return this.send.mock.calls.map(([d]) => (typeof d === 'string' ? JSON.parse(d) : d));
  }
}

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An unsigned JWT-shaped token expiring `inMs` from now (the client never checks signatures). */
function jwt(inMs: number, sub = 'user-a'): string {
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub, exp: Math.floor((Date.now() + inMs) / 1000) })}.sig`;
}

/** A controllable session: the token held, refresh results and the refresh event. */
function fakeAuth(initial: string | null) {
  let token = initial;
  const listeners = new Set<(t: string) => void>();
  const refreshResults: Array<string | null> = [];
  const auth: TerminalAuth & {
    nextRefresh(t: string | null): void;
    emitRefreshed(t: string): void;
    listenerCount(): number;
  } = {
    getAccessToken: () => token,
    refreshAccessToken: vi.fn(async () => {
      const next = refreshResults.length ? refreshResults.shift()! : null;
      if (!next) return false;
      token = next;
      listeners.forEach((l) => l(next));
      return true;
    }),
    onAccessTokenRefreshed: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    nextRefresh: (t) => refreshResults.push(t),
    emitRefreshed: (t) => {
      token = t;
      listeners.forEach((l) => l(t));
    },
    listenerCount: () => listeners.size,
  };
  return auth;
}

/** Open the socket and complete auth + connect. */
function attach(tws: TerminalWebSocket): MockWebSocket {
  tws.connect();
  const ws = MockWebSocket.instances.at(-1)!;
  ws.open();
  ws.message({ type: 'auth_ok' });
  ws.message({ type: 'session_ready' });
  return ws;
}

describe('TerminalWebSocket re-authentication (#47)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('authenticates with the session token read at open time', () => {
    const token = jwt(15 * 60_000);
    const tws = new TerminalWebSocket('s-1', fakeAuth(token));
    tws.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    expect(ws.sent()[0]).toEqual({ type: 'auth', token });
  });

  it('re-sends auth (and never connect) after an access-token refresh', () => {
    const auth = fakeAuth(jwt(15 * 60_000));
    const ws = attach(new TerminalWebSocket('s-1', auth));
    ws.send.mockClear();

    const fresh = jwt(15 * 60_000, 'user-a');
    auth.emitRefreshed(fresh);

    expect(ws.sent()).toEqual([{ type: 'auth', token: fresh }]);

    ws.message({ type: 'auth_refreshed' });
    expect(ws.sent().filter((m) => (m as { type?: string }).type === 'connect')).toHaveLength(0);
  });

  it('does not send a token before the gateway accepted the first one', () => {
    const auth = fakeAuth(jwt(15 * 60_000));
    const tws = new TerminalWebSocket('s-1', auth);
    tws.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.send.mockClear();
    auth.emitRefreshed(jwt(15 * 60_000));
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('refreshes proactively shortly before exp and presents the new token', async () => {
    const auth = fakeAuth(jwt(5 * 60_000));
    const fresh = jwt(15 * 60_000);
    auth.nextRefresh(fresh);
    const ws = attach(new TerminalWebSocket('s-1', auth));
    ws.send.mockClear();

    await vi.advanceTimersByTimeAsync(5 * 60_000 - REFRESH_LEAD_MS - 1_000);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(ws.sent()).toContainEqual({ type: 'auth', token: fresh });
  });

  it('plans the next refresh from the token confirmed by auth_refreshed', async () => {
    const auth = fakeAuth(jwt(5 * 60_000));
    auth.nextRefresh(jwt(10 * 60_000));
    const ws = attach(new TerminalWebSocket('s-1', auth));

    await vi.advanceTimersByTimeAsync(5 * 60_000 - REFRESH_LEAD_MS + 10);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    ws.message({ type: 'auth_refreshed' });

    // The new token expires 10 min after the start: its refresh is due at 9 min.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it('on auth_expired refreshes once and reconnects with the fresh token', async () => {
    const auth = fakeAuth(jwt(15 * 60_000));
    const fresh = jwt(15 * 60_000);
    auth.nextRefresh(fresh);
    const tws = new TerminalWebSocket('s-1', auth);
    const expired = vi.fn();
    tws.on('expired', expired);
    const first = attach(tws);

    first.message({ type: 'auth_expired' });
    first.serverClose();
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    const second = MockWebSocket.instances[1];
    second.open();
    expect(second.sent()[0]).toEqual({ type: 'auth', token: fresh });
    second.message({ type: 'auth_ok' });
    expect(second.sent()[1]).toEqual({ type: 'connect', sessionId: 's-1' });
    expect(expired).not.toHaveBeenCalled();

    // The close that followed auth_expired scheduled no extra reconnect.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('on auth_expired with a refused refresh reports expiry and stops', async () => {
    const auth = fakeAuth(jwt(15 * 60_000));
    const tws = new TerminalWebSocket('s-1', auth);
    const expired = vi.fn();
    const error = vi.fn();
    tws.on('expired', expired);
    tws.on('error', error);
    const ws = attach(tws);

    ws.message({ type: 'auth_expired' });
    ws.serverClose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(expired).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(new Error(EXPIRED_MESSAGE));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(auth.listenerCount()).toBe(0);
  });

  it('gives up when a second expiry arrives before the session is ready again', async () => {
    const auth = fakeAuth(jwt(15 * 60_000));
    auth.nextRefresh(jwt(15 * 60_000));
    const tws = new TerminalWebSocket('s-1', auth);
    const expired = vi.fn();
    tws.on('expired', expired);
    const first = attach(tws);

    first.message({ type: 'auth_expired' });
    await vi.advanceTimersByTimeAsync(0);
    const second = MockWebSocket.instances[1];
    second.open();
    second.message({ type: 'auth_ok' });
    second.message({ type: 'auth_expired' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('treats auth_fail forbidden as final: emits forbidden and never reconnects', async () => {
    const tws = new TerminalWebSocket('s-1', fakeAuth(jwt(15 * 60_000)));
    const forbidden = vi.fn();
    const error = vi.fn();
    tws.on('forbidden', forbidden);
    tws.on('error', error);
    tws.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.message({ type: 'auth_fail', reason: 'forbidden' });
    ws.serverClose();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(new Error(FORBIDDEN_MESSAGE));
    expect(ws.close).toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reports NOT_FOUND for an unknown or foreign session', () => {
    const tws = new TerminalWebSocket('s-1', fakeAuth(jwt(15 * 60_000)));
    const error = vi.fn();
    tws.on('error', error);
    tws.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.message({ type: 'auth_ok' });
    ws.message({ type: 'session_error', code: 'NOT_FOUND' });
    expect(error).toHaveBeenCalledWith(new Error('Session not found'));
  });

  it('reconnects after a dropped connection with the token held now, not the first one', async () => {
    const auth = fakeAuth(jwt(15 * 60_000));
    const ws = attach(new TerminalWebSocket('s-1', auth));
    const fresh = jwt(15 * 60_000);
    auth.emitRefreshed(fresh);
    ws.serverClose();

    await vi.advanceTimersByTimeAsync(1_000);
    const next = MockWebSocket.instances[1];
    next.open();
    expect(next.sent()[0]).toEqual({ type: 'auth', token: fresh });
  });

  it('reports expiry instead of opening a session when no token is held', () => {
    const tws = new TerminalWebSocket('s-1', fakeAuth(null));
    const expired = vi.fn();
    tws.on('expired', expired);
    tws.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    expect(ws.send).not.toHaveBeenCalled();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('stops listening for refreshes and timers on disconnect', async () => {
    const auth = fakeAuth(jwt(2 * 60_000));
    const tws = new TerminalWebSocket('s-1', auth);
    attach(tws);
    expect(auth.listenerCount()).toBe(1);
    tws.disconnect();
    expect(auth.listenerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
  });
});

/** A JWT-shaped token issued now (with `iat`) that lives `lifetimeMs`. */
function issued(lifetimeMs: number): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256' })}.${b64url({
    sub: 'user-a',
    iat: now,
    exp: now + Math.floor(lifetimeMs / 1000),
  })}.sig`;
}

/**
 * A session whose every refresh mints a token of `lifetimeMs` at call time,
 * like the API does, and a socket whose gateway confirms each re-sent `auth`
 * with `auth_refreshed`.
 */
function mintingSession(lifetimeMs: number) {
  let token = issued(lifetimeMs);
  const listeners = new Set<(t: string) => void>();
  const auth: TerminalAuth = {
    getAccessToken: () => token,
    refreshAccessToken: vi.fn(async () => {
      token = issued(lifetimeMs);
      listeners.forEach((l) => l(token));
      return true;
    }),
    onAccessTokenRefreshed: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const ws = attach(new TerminalWebSocket('s-1', auth));
  ws.send.mockImplementation((d: unknown) => {
    if (typeof d === 'string' && (JSON.parse(d) as { type?: string }).type === 'auth') {
      queueMicrotask(() => ws.message({ type: 'auth_refreshed' }));
    }
  });
  return { auth, ws };
}

describe('TerminalWebSocket refresh cadence (#93)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refreshes a 60 s token a handful of times over 90 s, not once a second', async () => {
    const { auth } = mintingSession(60_000);
    await vi.advanceTimersByTimeAsync(90_000);
    const calls = vi.mocked(auth.refreshAccessToken).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(6);
  });

  it('refreshes a 60 s token 12 s (20%) before it expires', async () => {
    const { auth } = mintingSession(60_000);
    await vi.advanceTimersByTimeAsync(47_000);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('keeps the 60 s lead for a 15-minute token', async () => {
    const { auth } = mintingSession(15 * 60_000);
    await vi.advanceTimersByTimeAsync(15 * 60_000 - REFRESH_LEAD_MS - 1_000);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    // The next one is a full lifetime minus the lead later.
    await vi.advanceTimersByTimeAsync(15 * 60_000 - REFRESH_LEAD_MS - 2_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it('never refreshes more often than every 10 s, even when each new token looks expired', async () => {
    // A local clock far ahead of the server's: every token reads as already expired.
    const listeners = new Set<(t: string) => void>();
    let token = jwt(-5_000);
    const auth: TerminalAuth = {
      getAccessToken: () => token,
      refreshAccessToken: vi.fn(async () => {
        token = jwt(-5_000);
        listeners.forEach((l) => l(token));
        return true;
      }),
      onAccessTokenRefreshed: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const ws = attach(new TerminalWebSocket('s-1', auth));
    ws.send.mockImplementation((d: unknown) => {
      if (typeof d === 'string' && (JSON.parse(d) as { type?: string }).type === 'auth') {
        queueMicrotask(() => ws.message({ type: 'auth_refreshed' }));
      }
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(auth.refreshAccessToken).mock.calls.length).toBeLessThanOrEqual(
      60_000 / MIN_REFRESH_INTERVAL_MS + 1,
    );
  });

  it('does not refresh a token someone else just refreshed', async () => {
    const auth = fakeAuth(jwt(5 * 60_000));
    attach(new TerminalWebSocket('s-1', auth));
    // An HTTP 401-retry refreshed first; the gateway has not confirmed it yet.
    await vi.advanceTimersByTimeAsync(60_000);
    auth.emitRefreshed(jwt(15 * 60_000));
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('shares one in-flight refresh between the timer and an expiry recovery', async () => {
    let resolveRefresh: (ok: boolean) => void = () => undefined;
    let token = jwt(60_000);
    const listeners = new Set<(t: string) => void>();
    const auth: TerminalAuth = {
      getAccessToken: () => token,
      refreshAccessToken: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRefresh = (ok) => {
              if (ok) {
                token = jwt(60_000);
                listeners.forEach((l) => l(token));
              }
              resolve(ok);
            };
          }),
      ),
      onAccessTokenRefreshed: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const first = attach(new TerminalWebSocket('s-1', auth));
    await vi.advanceTimersByTimeAsync(50_000); // the timer's refresh is now in flight
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);

    first.message({ type: 'auth_expired' });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);

    resolveRefresh(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('refreshDelayMs', () => {
  const now = 1_000_000_000_000;

  it('uses a 60 s lead for tokens living 5 minutes or more', () => {
    expect(refreshDelayMs(now + 15 * 60_000, now, now, null)).toBe(14 * 60_000);
    expect(refreshDelayMs(now + 5 * 60_000, now, now, null)).toBe(4 * 60_000);
  });

  it('uses 20% of the lifetime as the lead for shorter tokens', () => {
    expect(refreshDelayMs(now + 60_000, now, now, null)).toBe(48_000);
    expect(refreshDelayMs(now + 30_000, now, now, null)).toBe(24_000);
  });

  it('falls back to the time left when the token has no iat', () => {
    expect(refreshDelayMs(now + 60_000, null, now, null)).toBe(48_000);
  });

  it('keeps refreshes at least MIN_REFRESH_INTERVAL_MS apart', () => {
    expect(refreshDelayMs(now - 1_000, now - 61_000, now, now)).toBe(MIN_REFRESH_INTERVAL_MS);
    expect(refreshDelayMs(now + 5_000, now, now, now - 3_000)).toBe(MIN_REFRESH_INTERVAL_MS - 3_000);
  });

  it('refreshes at once an expired token that was not just refreshed', () => {
    expect(refreshDelayMs(now - 1_000, null, now, null)).toBe(0);
  });
});

describe('tokenIssuedAtMs', () => {
  it('reads iat from a JWT payload', () => {
    expect(tokenIssuedAtMs(`h.${b64url({ iat: 1_900_000_000 })}.s`)).toBe(1_900_000_000_000);
  });

  it('returns null without iat', () => {
    expect(tokenIssuedAtMs(`h.${b64url({ exp: 1 })}.s`)).toBeNull();
  });
});

describe('tokenExpiryMs', () => {
  it('reads exp from a JWT payload', () => {
    const payload = b64url({ exp: 1_900_000_000 });
    expect(tokenExpiryMs(`h.${payload}.s`)).toBe(1_900_000_000_000);
  });

  it.each([['not-a-jwt'], ['a.!!!.c'], [`a.${b64url({ sub: 'x' })}.c`]])(
    'returns null for %s',
    (token) => {
      expect(tokenExpiryMs(token)).toBeNull();
    },
  );
});
