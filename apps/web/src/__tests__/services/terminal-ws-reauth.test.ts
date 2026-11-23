import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TerminalWebSocket,
  EXPIRED_MESSAGE,
  FORBIDDEN_MESSAGE,
  REFRESH_LEAD_MS,
  tokenExpiryMs,
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
    const auth = fakeAuth(jwt(2 * 60_000));
    auth.nextRefresh(jwt(10 * 60_000));
    const ws = attach(new TerminalWebSocket('s-1', auth));

    await vi.advanceTimersByTimeAsync(2 * 60_000 - REFRESH_LEAD_MS + 10);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    ws.message({ type: 'auth_refreshed' });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
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
