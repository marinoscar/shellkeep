import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalWebSocket } from '../../services/terminal-ws';

/**
 * Issue #60: the gateway refuses a `connect` whose server presents an unknown
 * or changed host key with one `session_error` carrying the code and both
 * fingerprints, and keeps the socket open. The client prompts instead of
 * reporting an error, and asks again on the same socket after trust.
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


function attachUntilConnect(tws: TerminalWebSocket): MockWebSocket {
  tws.connect();
  const ws = MockWebSocket.instances.at(-1)!;
  ws.open();
  ws.message({ type: 'auth_ok' });
  return ws;
}

const REFUSAL = {
  type: 'session_error',
  error: 'Host key not trusted',
  code: 'HOST_KEY_UNKNOWN',
  presented: { fingerprint: 'SHA256:presentedKeyFingerprintAAAAAAAAAAAAAAAAAAAA', algorithm: 'ssh-ed25519' },
  expected: null,
  serverProfileId: 'profile-a',
};

describe('TerminalWebSocket host-key refusals (#60)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits host_key (not error) with the refusal and keeps the socket open', () => {
    const tws = new TerminalWebSocket('s-1', 'token');
    const onHostKey = vi.fn();
    const onError = vi.fn();
    tws.on('host_key', onHostKey);
    tws.on('error', onError);
    const ws = attachUntilConnect(tws);

    ws.message(REFUSAL);

    expect(onHostKey).toHaveBeenCalledWith({
      code: 'HOST_KEY_UNKNOWN',
      presented: REFUSAL.presented,
      expected: null,
      serverProfileId: 'profile-a',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('carries the expected fingerprint of a mismatch', () => {
    const tws = new TerminalWebSocket('s-1', 'token');
    const onHostKey = vi.fn();
    tws.on('host_key', onHostKey);
    const ws = attachUntilConnect(tws);

    ws.message({ ...REFUSAL, code: 'HOST_KEY_MISMATCH', expected: 'SHA256:trustedKeyFingerprintBBBBBBBBBBBBBBBBBBBBBBB' });

    expect(onHostKey.mock.calls[0][0]).toMatchObject({
      code: 'HOST_KEY_MISMATCH',
      expected: 'SHA256:trustedKeyFingerprintBBBBBBBBBBBBBBBBBBBBBBB',
    });
  });

  it('still reports any other session_error as an error', () => {
    const tws = new TerminalWebSocket('s-1', 'token');
    const onHostKey = vi.fn();
    const onError = vi.fn();
    tws.on('host_key', onHostKey);
    tws.on('error', onError);
    const ws = attachUntilConnect(tws);

    ws.message({ type: 'session_error', code: 'NOT_FOUND' });

    expect(onHostKey).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('Session not found');
  });

  it('retryConnect sends connect again on the same open socket', () => {
    const tws = new TerminalWebSocket('s-1', 'token');
    const ws = attachUntilConnect(tws);
    ws.message(REFUSAL);
    ws.send.mockClear();

    tws.retryConnect();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.sent()).toEqual([{ type: 'connect', sessionId: 's-1' }]);
  });

  it('retryConnect opens a fresh socket when the old one is closed', () => {
    const tws = new TerminalWebSocket('s-1', 'token');
    const ws = attachUntilConnect(tws);
    ws.readyState = MockWebSocket.CLOSED;

    tws.retryConnect();

    expect(MockWebSocket.instances).toHaveLength(2);
    const fresh = MockWebSocket.instances[1];
    fresh.open();
    expect(fresh.sent()[0]).toEqual({ type: 'auth', token: 'token' });
  });
});
