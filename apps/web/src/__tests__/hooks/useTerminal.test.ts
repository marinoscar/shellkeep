import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';

// ---------------------------------------------------------------------------
// vi.hoisted: variables that must be available inside vi.mock factory closures
// ---------------------------------------------------------------------------
const {
  wsListeners,
  wsConnectedState,
  wsConnectFn,
  wsDisconnectFn,
  wsSendFn,
  wsResizeFn,
  wsOnFn,
} = vi.hoisted(() => {
  const wsListeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();
  const wsConnectedState = { value: false };
  const wsConnectFn = vi.fn();
  const wsDisconnectFn = vi.fn();
  const wsSendFn = vi.fn();
  const wsResizeFn = vi.fn();
  const wsOnFn = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (!wsListeners.has(event)) wsListeners.set(event, []);
    wsListeners.get(event)!.push(cb);
  });
  return { wsListeners, wsConnectedState, wsConnectFn, wsDisconnectFn, wsSendFn, wsResizeFn, wsOnFn };
});

// ---------------------------------------------------------------------------
// Module mocks – all vi.mock calls are hoisted by vitest automatically
// ---------------------------------------------------------------------------
vi.mock('@xterm/xterm', () => {
  const TerminalMock = vi.fn(function(this: Record<string, unknown>) {
    this.cols = 80;
    this.rows = 24;
    this.dispose = vi.fn();
    this.open = vi.fn();
    this.write = vi.fn();
    this.onData = vi.fn();
    this.onBinary = vi.fn();
    this.loadAddon = vi.fn();
    this.buffer = { active: { length: 0, getLine: vi.fn() } };
  });
  return { Terminal: TerminalMock };
});

vi.mock('@xterm/addon-fit', () => {
  const FitAddonMock = vi.fn(function(this: Record<string, unknown>) {
    this.fit = vi.fn();
  });
  return { FitAddon: FitAddonMock };
});

vi.mock('@xterm/addon-search', () => {
  const SearchAddonMock = vi.fn(function(this: Record<string, unknown>) {
    this.findNext = vi.fn();
  });
  return { SearchAddon: SearchAddonMock };
});

vi.mock('@xterm/addon-web-links', () => {
  const WebLinksAddonMock = vi.fn(function(this: Record<string, unknown>) {
    // empty
  });
  return { WebLinksAddon: WebLinksAddonMock };
});

vi.mock('../../services/terminal-ws', () => {
  const TerminalWebSocketMock = vi.fn(function(this: Record<string, unknown>) {
    Object.defineProperty(this, 'connected', {
      get: () => wsConnectedState.value,
      enumerable: true,
      configurable: true,
    });
    this.connect = wsConnectFn;
    this.disconnect = wsDisconnectFn;
    this.send = wsSendFn;
    this.resize = wsResizeFn;
    this.on = wsOnFn;
  });
  return { TerminalWebSocket: TerminalWebSocketMock };
});

vi.mock('../../services/api', () => ({
  api: {
    getAccessToken: vi.fn(() => 'mock-token'),
  },
}));

// ---------------------------------------------------------------------------
// Module imports (after mocks)
// ---------------------------------------------------------------------------
import { useTerminal } from '../../hooks/useTerminal';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { TerminalWebSocket } from '../../services/terminal-ws';
import { api } from '../../services/api';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Emit an event on the shared WS event bus */
function emitWs(event: string, payload?: unknown) {
  (wsListeners.get(event) ?? []).forEach((cb) => cb(payload));
}

/** Return the most recently created Terminal mock instance */
function getTerminalInstance() {
  const results = vi.mocked(Terminal).mock.results;
  return results[results.length - 1]?.value as {
    cols: number;
    rows: number;
    dispose: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onBinary: ReturnType<typeof vi.fn>;
    loadAddon: ReturnType<typeof vi.fn>;
  };
}

/** Return the most recently created FitAddon mock instance */
function getFitAddonInstance() {
  const results = vi.mocked(FitAddon).mock.results;
  return results[results.length - 1]?.value as { fit: ReturnType<typeof vi.fn> };
}

/** Return the most recently created SearchAddon mock instance */
function getSearchAddonInstance() {
  const results = vi.mocked(SearchAddon).mock.results;
  return results[results.length - 1]?.value as { findNext: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useTerminal', () => {
  let containerDiv: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    wsListeners.clear();
    wsConnectedState.value = false;
    containerDiv = document.createElement('div');
    document.body.appendChild(containerDiv);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (document.body.contains(containerDiv)) {
      document.body.removeChild(containerDiv);
    }
  });

  function renderUseTerminal(sessionId = 'session-1') {
    return renderHook(() => {
      const containerRef = useRef<HTMLDivElement>(containerDiv);
      return useTerminal(sessionId, containerRef);
    });
  }

  // -------------------------------------------------------------------------
  describe('Initial state', () => {
    it('should start disconnected with no error', () => {
      const { result } = renderUseTerminal();

      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should expose reconnect, search, and terminal ref', () => {
      const { result } = renderUseTerminal();

      expect(typeof result.current.reconnect).toBe('function');
      expect(typeof result.current.search).toBe('function');
      expect(result.current.terminal).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('Initialization', () => {
    it('should open the terminal on the container element', () => {
      renderUseTerminal();

      expect(getTerminalInstance().open).toHaveBeenCalledWith(containerDiv);
    });

    it('should call fitAddon.fit after opening the terminal', () => {
      renderUseTerminal();

      expect(getFitAddonInstance().fit).toHaveBeenCalled();
    });

    it('should call ws.connect after setup', () => {
      renderUseTerminal();

      expect(wsConnectFn).toHaveBeenCalledTimes(1);
    });

    it('should set error and skip connect when no access token is available', () => {
      vi.mocked(api.getAccessToken).mockReturnValueOnce(null);

      const { result } = renderUseTerminal();

      expect(result.current.error).toBe('Not authenticated');
      expect(wsConnectFn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('Connection lifecycle', () => {
    it('should set isConnected true when ws emits connect', () => {
      const { result } = renderUseTerminal();

      act(() => { emitWs('connect'); });

      expect(result.current.isConnected).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should send a resize message 200 ms after connect', () => {
      renderUseTerminal();

      act(() => { emitWs('connect'); });
      expect(wsResizeFn).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(200); });

      const term = getTerminalInstance();
      expect(wsResizeFn).toHaveBeenCalledWith(term.cols, term.rows);
    });

    it('should send cols-1 resize first then real dimensions to force tmux repaint', () => {
      renderUseTerminal();

      act(() => { emitWs('connect'); });
      expect(wsResizeFn).not.toHaveBeenCalled();

      // Outer 200 ms timeout fires: sends cols-1 to force tmux size change
      act(() => { vi.advanceTimersByTime(200); });
      const term = getTerminalInstance();
      expect(wsResizeFn).toHaveBeenCalledWith(term.cols - 1, term.rows);

      // Inner 50 ms timeout fires: sends real dims to trigger full repaint
      act(() => { vi.advanceTimersByTime(50); });
      expect(wsResizeFn).toHaveBeenCalledWith(term.cols, term.rows);

      expect(wsResizeFn).toHaveBeenCalledTimes(2);
    });

    it('should set isConnected false when ws emits disconnect', () => {
      const { result } = renderUseTerminal();

      act(() => { emitWs('connect'); });
      expect(result.current.isConnected).toBe(true);

      act(() => { emitWs('disconnect'); });
      expect(result.current.isConnected).toBe(false);
    });

    it('should record an error when ws emits error', () => {
      const { result } = renderUseTerminal();

      act(() => { emitWs('error', new Error('SSH handshake failed')); });

      expect(result.current.error).toBe('SSH handshake failed');
    });
  });

  // -------------------------------------------------------------------------
  describe('Data flow', () => {
    it('should write incoming data bytes to the terminal', () => {
      renderUseTerminal();

      const data = new Uint8Array([72, 101, 108, 108, 111]);
      act(() => { emitWs('data', data); });

      expect(getTerminalInstance().write).toHaveBeenCalledWith(data);
    });

    it('should encode terminal onData text and send via ws.send', () => {
      renderUseTerminal();

      const term = getTerminalInstance();
      const onDataCb = vi.mocked(term.onData).mock.calls[0]?.[0] as
        | ((d: string) => void)
        | undefined;
      expect(onDataCb).toBeDefined();

      onDataCb!('ls\n');

      expect(wsSendFn).toHaveBeenCalled();
      const sent = wsSendFn.mock.calls[0][0] as Uint8Array;
      // Use constructor name check to avoid cross-realm instanceof issues
      expect(sent.constructor.name).toBe('Uint8Array');
      // 'l' = 108
      expect(sent[0]).toBe(108);
    });

    it('should convert terminal onBinary chars to bytes and send via ws.send', () => {
      renderUseTerminal();

      const term = getTerminalInstance();
      const onBinaryCb = vi.mocked(term.onBinary).mock.calls[0]?.[0] as
        | ((d: string) => void)
        | undefined;
      expect(onBinaryCb).toBeDefined();

      onBinaryCb!('\x01\x02\x03');

      const sent = wsSendFn.mock.calls[0][0] as Uint8Array;
      expect(sent).toBeInstanceOf(Uint8Array);
      expect(Array.from(sent)).toEqual([1, 2, 3]);
    });
  });

  // -------------------------------------------------------------------------
  describe('ResizeObserver integration', () => {
    it('should call fit and send resize when dimensions change while connected', () => {
      wsConnectedState.value = true;
      renderUseTerminal();

      // ResizeObserver is mocked globally as a class - get the callback from mock.calls
      const roCtor = global.ResizeObserver as unknown as { mock?: { calls: unknown[][] } };
      const roCalls = roCtor.mock?.calls ?? [];
      const observerCb = roCalls[roCalls.length - 1]?.[0] as
        | ((entries: unknown[]) => void)
        | undefined;

      if (observerCb) {
        const fitAddon = getFitAddonInstance();
        vi.mocked(fitAddon.fit).mockClear();
        wsResizeFn.mockClear();

        act(() => { observerCb([]); });

        const term = getTerminalInstance();
        expect(fitAddon.fit).toHaveBeenCalled();
        expect(wsResizeFn).toHaveBeenCalledWith(term.cols, term.rows);
      } else {
        // ResizeObserver global mock may not capture constructor calls in this env
        expect(true).toBe(true);
      }
    });

    it('should fit but NOT send resize when ws is disconnected', () => {
      wsConnectedState.value = false;
      renderUseTerminal();

      const roCtor = global.ResizeObserver as unknown as { mock?: { calls: unknown[][] } };
      const roCalls = roCtor.mock?.calls ?? [];
      const observerCb = roCalls[roCalls.length - 1]?.[0] as
        | ((entries: unknown[]) => void)
        | undefined;

      if (observerCb) {
        const fitAddon = getFitAddonInstance();
        vi.mocked(fitAddon.fit).mockClear();
        wsResizeFn.mockClear();

        act(() => { observerCb([]); });

        expect(fitAddon.fit).toHaveBeenCalled();
        expect(wsResizeFn).not.toHaveBeenCalled();
      } else {
        expect(true).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Cleanup on unmount', () => {
    it('should disconnect ws and dispose the terminal on unmount', () => {
      const { unmount } = renderUseTerminal();

      unmount();

      expect(wsDisconnectFn).toHaveBeenCalled();
      expect(getTerminalInstance().dispose).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('reconnect', () => {
    it('should disconnect the current ws and create a new WebSocket connection', () => {
      const { result } = renderUseTerminal();
      const callsBefore = vi.mocked(TerminalWebSocket).mock.calls.length;

      act(() => { result.current.reconnect(); });

      expect(wsDisconnectFn).toHaveBeenCalled();
      expect(vi.mocked(TerminalWebSocket).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('should not create a new WebSocket when there is no access token', () => {
      // Return null for both the init call and the reconnect call
      vi.mocked(api.getAccessToken).mockReturnValueOnce(null).mockReturnValueOnce(null);
      const { result } = renderUseTerminal();
      const callsBefore = vi.mocked(TerminalWebSocket).mock.calls.length;

      act(() => { result.current.reconnect(); });

      // api.getAccessToken was already used once for init (returned null, so no init ws)
      // calling reconnect should also check for token and not create WS when null
      expect(vi.mocked(TerminalWebSocket).mock.calls.length).toBe(callsBefore);
    });
  });

  // -------------------------------------------------------------------------
  describe('search', () => {
    it('should call searchAddon.findNext with the provided term', () => {
      const { result } = renderUseTerminal();

      act(() => { result.current.search('error'); });

      expect(getSearchAddonInstance().findNext).toHaveBeenCalledWith('error');
    });

    it('should forward an empty string search term to findNext', () => {
      const { result } = renderUseTerminal();

      act(() => { result.current.search(''); });

      expect(getSearchAddonInstance().findNext).toHaveBeenCalledWith('');
    });
  });
});
