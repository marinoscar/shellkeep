import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalWebSocket } from '../../services/terminal-ws';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  binaryType: string = 'blob';
  readyState: number = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    // Store reference so tests can access it
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }

  // Helpers for tests
  simulateOpen() {
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent);
  }

  simulateClose() {
    this.onclose?.({} as CloseEvent);
  }

  simulateError() {
    this.onerror?.(new Event('error'));
  }
}

// Install mock
const originalWebSocket = global.WebSocket;

describe('TerminalWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    (global as any).WebSocket = MockWebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    (global as any).WebSocket = originalWebSocket;
  });

  describe('connect()', () => {
    it('should create WebSocket with correct URL', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      expect(MockWebSocket.instances).toHaveLength(1);
      const ws = MockWebSocket.instances[0];
      expect(ws.url).toBe('ws://localhost:3000/api/terminal/ws');
      expect(ws.binaryType).toBe('arraybuffer');
    });

    it('should not be connected initially', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      expect(tws.connected).toBe(false);
    });
  });

  describe('Auth Flow', () => {
    it('should send auth message on open', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth', token: 'my-token' }),
      );
    });

    it('should send connect message after auth_ok', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.send.mockClear();

      ws.simulateMessage(JSON.stringify({ type: 'auth_ok' }));

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'connect', sessionId: 'session-123' }),
      );
    });

    it('should emit error and disconnect on auth_fail', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const errorHandler = vi.fn();
      tws.on('error', errorHandler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      ws.simulateMessage(JSON.stringify({ type: 'auth_fail', reason: 'Invalid token' }));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(errorHandler.mock.calls[0][0].message).toBe('Invalid token');
    });

    it('should set connected=true and emit connect on session_ready', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const connectHandler = vi.fn();
      tws.on('connect', connectHandler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'auth_ok' }));
      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));

      expect(tws.connected).toBe(true);
      expect(connectHandler).toHaveBeenCalledWith(null);
    });

    it('should emit error on session_error', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const errorHandler = vi.fn();
      tws.on('error', errorHandler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'session_error', error: 'Not found' }));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(errorHandler.mock.calls[0][0].message).toBe('Not found');
    });

    it('should emit disconnect on session_ended', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const disconnectHandler = vi.fn();
      tws.on('disconnect', disconnectHandler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'session_ended', reason: 'timeout' }));

      expect(tws.connected).toBe(false);
      expect(disconnectHandler).toHaveBeenCalledWith('timeout');
    });
  });

  describe('Binary Data', () => {
    it('should emit data event for ArrayBuffer messages', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const dataHandler = vi.fn();
      tws.on('data', dataHandler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      const buffer = new ArrayBuffer(4);
      const view = new Uint8Array(buffer);
      view[0] = 72; // 'H'
      view[1] = 101; // 'e'
      view[2] = 108; // 'l'
      view[3] = 108; // 'l'

      ws.simulateMessage(buffer);

      expect(dataHandler).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(dataHandler.mock.calls[0][0]).toEqual(new Uint8Array([72, 101, 108, 108]));
    });
  });

  describe('disconnect()', () => {
    it('should close WebSocket and set connected to false', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'auth_ok' }));
      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));
      expect(tws.connected).toBe(true);

      tws.disconnect();

      expect(ws.close).toHaveBeenCalled();
      expect(tws.connected).toBe(false);
    });

    it('should prevent reconnect after disconnect', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      tws.disconnect();

      // Simulate close event - should NOT create new WebSocket
      ws.simulateClose();

      // Advance timers - no reconnect should happen
      vi.advanceTimersByTime(60000);

      // Only the original WebSocket should exist
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  describe('resize()', () => {
    it('should send resize message when connected', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.OPEN;

      tws.resize(120, 40);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
      );
    });

    it('should not send resize when WebSocket is not open', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.CLOSED;
      ws.send.mockClear();

      tws.resize(120, 40);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('should send binary data when connected', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.OPEN;
      ws.send.mockClear();

      const data = new Uint8Array([65, 66, 67]);
      tws.send(data);

      expect(ws.send).toHaveBeenCalledWith(data);
    });

    it('should not send when WebSocket is not open', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.readyState = MockWebSocket.CLOSED;
      ws.send.mockClear();

      tws.send(new Uint8Array([65]));

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('Reconnect with Exponential Backoff', () => {
    it('should attempt reconnect after connection close', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateClose();

      // First reconnect: 1000ms delay (1000 * 2^0)
      vi.advanceTimersByTime(1000);

      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('should use exponential backoff for delays', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      // First close -> reconnect after 1s
      MockWebSocket.instances[0].simulateClose();
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);

      // Second close -> reconnect after 2s
      MockWebSocket.instances[1].simulateClose();
      vi.advanceTimersByTime(2000);
      expect(MockWebSocket.instances).toHaveLength(3);

      // Third close -> reconnect after 4s
      MockWebSocket.instances[2].simulateClose();
      vi.advanceTimersByTime(4000);
      expect(MockWebSocket.instances).toHaveLength(4);
    });

    it('should cap reconnect delay at 30 seconds', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      // Trigger many reconnects to exceed 30s cap
      for (let i = 0; i < 6; i++) {
        MockWebSocket.instances[i].simulateClose();
        vi.advanceTimersByTime(30000);
      }

      // After 6 attempts, delay would be 1000 * 2^5 = 32000, capped at 30000
      const prevCount = MockWebSocket.instances.length;
      MockWebSocket.instances[prevCount - 1].simulateClose();
      vi.advanceTimersByTime(30000);
      expect(MockWebSocket.instances.length).toBe(prevCount + 1);
    });

    it('should stop reconnecting after max attempts', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      // Trigger 10 reconnects (max)
      for (let i = 0; i < 10; i++) {
        MockWebSocket.instances[i].simulateClose();
        vi.advanceTimersByTime(30000);
      }

      const count = MockWebSocket.instances.length;
      MockWebSocket.instances[count - 1].simulateClose();
      vi.advanceTimersByTime(60000);

      // Should not have created any new WebSocket instances
      expect(MockWebSocket.instances.length).toBe(count);
    });

    it('should reset reconnect attempts on successful session_ready', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      // Simulate some reconnect attempts
      MockWebSocket.instances[0].simulateClose();
      vi.advanceTimersByTime(1000);
      MockWebSocket.instances[1].simulateClose();
      vi.advanceTimersByTime(2000);

      // Now successful connection
      const ws = MockWebSocket.instances[2];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'auth_ok' }));
      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));

      // Close again - should start from first delay (1s)
      ws.simulateClose();
      vi.advanceTimersByTime(1000);

      expect(MockWebSocket.instances.length).toBe(4);
    });
  });

  describe('Event Listeners', () => {
    it('should support on/off for event listeners', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const handler = vi.fn();

      tws.on('error', handler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateError();

      expect(handler).toHaveBeenCalledTimes(1);

      handler.mockClear();
      tws.off('error', handler);

      ws.simulateError();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should support multiple listeners for same event', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      tws.on('connect', handler1);
      tws.on('connect', handler2);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'auth_ok' }));
      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ping/Pong', () => {
    it('should start sending pings after session_ready', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'auth_ok' }));
      ws.send.mockClear();

      ws.simulateMessage(JSON.stringify({ type: 'session_ready' }));

      // Advance past ping interval (30s)
      vi.advanceTimersByTime(30000);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ping' }),
      );
    });

    it('should handle pong messages without error', () => {
      const tws = new TerminalWebSocket('session-123', 'my-token');
      const errorHandler = vi.fn();
      tws.on('error', errorHandler);
      tws.connect();

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage(JSON.stringify({ type: 'pong' }));

      expect(errorHandler).not.toHaveBeenCalled();
    });
  });
});
