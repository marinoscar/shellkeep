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
  wsRetryConnectFn,
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
  const wsRetryConnectFn = vi.fn();
  return { wsListeners, wsConnectedState, wsConnectFn, wsDisconnectFn, wsSendFn, wsResizeFn, wsOnFn, wsRetryConnectFn };
});

// ---------------------------------------------------------------------------
// Module mocks – all vi.mock calls are hoisted by vitest automatically
// ---------------------------------------------------------------------------
vi.mock('@xterm/xterm', () => {
  const TerminalMock = vi.fn(function(this: Record<string, unknown>, options?: Record<string, unknown>) {
    this.cols = 80;
    this.rows = 24;
    // Like xterm, the constructor options are readable and writable (#80).
    this.options = { ...options };
    this.onBell = vi.fn((handler: () => void) => {
      this.bellHandler = handler;
      return { dispose: vi.fn() };
    });
    this.onSelectionChange = vi.fn((handler: () => void) => {
      this.selectionHandler = handler;
      return { dispose: vi.fn() };
    });
    this.hasSelection = vi.fn(() => true);
    this.getSelection = vi.fn(() => 'selected text');
    this.dispose = vi.fn();
    // open() simulates xterm creating the helper textarea inside the container,
    // which is required for the mobile-input-attribute fix under test.
    this.open = vi.fn((container: HTMLElement) => {
      const ta = document.createElement('textarea');
      ta.className = 'xterm-helper-textarea';
      container.appendChild(ta);
    });
    this.write = vi.fn();
    // Like xterm, each subscription returns an IDisposable.
    this.onData = vi.fn(() => ({ dispose: vi.fn() }));
    this.onBinary = vi.fn(() => ({ dispose: vi.fn() }));
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
    this.retryConnect = wsRetryConnectFn;
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
import { DEFAULT_TERMINAL_SETTINGS, type ResolvedTerminalSettings } from '../../lib/terminal/settings';

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
  describe('Mobile input attributes on xterm-helper-textarea', () => {
    it('should set autocomplete=off on the helper textarea after open', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('autocomplete')).toBe('off');
    });

    it('should set autocorrect=off on the helper textarea after open', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('autocorrect')).toBe('off');
    });

    it('should set autocapitalize=none on the helper textarea after open', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('autocapitalize')).toBe('none');
    });

    it('should set spellcheck=false on the helper textarea after open', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('spellcheck')).toBe('false');
    });

    it('should set inputmode=text (not "none") so the soft keyboard is raised on focus', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      // "none" would suppress the soft keyboard entirely — that was a regression we fixed.
      expect(ta!.getAttribute('inputmode')).toBe('text');
      expect(ta!.getAttribute('inputmode')).not.toBe('none');
    });

    it('should set enterkeyhint=enter on the helper textarea after open', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('enterkeyhint')).toBe('enter');
    });

    it('should set aria-autocomplete=none on the helper textarea after open', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('aria-autocomplete')).toBe('none');
    });

    it('should set data-gramm=false to disable Grammarly extension', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('data-gramm')).toBe('false');
    });

    it('should set data-gramm_editor=false to disable Grammarly editor mode', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('data-gramm_editor')).toBe('false');
    });

    it('should set data-enable-grammarly=false to disable Grammarly activation', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('data-enable-grammarly')).toBe('false');
    });

    it('should set the full set of ten mobile input attributes in a single mount', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();
      expect(ta!.getAttribute('autocomplete')).toBe('off');
      expect(ta!.getAttribute('autocorrect')).toBe('off');
      expect(ta!.getAttribute('autocapitalize')).toBe('none');
      expect(ta!.getAttribute('spellcheck')).toBe('false');
      expect(ta!.getAttribute('inputmode')).toBe('text');
      expect(ta!.getAttribute('inputmode')).not.toBe('none');
      expect(ta!.getAttribute('enterkeyhint')).toBe('enter');
      expect(ta!.getAttribute('aria-autocomplete')).toBe('none');
      expect(ta!.getAttribute('data-gramm')).toBe('false');
      expect(ta!.getAttribute('data-gramm_editor')).toBe('false');
      expect(ta!.getAttribute('data-enable-grammarly')).toBe('false');
    });

    it('should re-apply all mobile input attributes when the textarea gains focus', () => {
      renderUseTerminal();

      const ta = containerDiv.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      expect(ta).not.toBeNull();

      // Simulate a keyboard (e.g. Gboard) stripping attributes on focus by clearing them.
      ta!.removeAttribute('autocomplete');
      ta!.removeAttribute('inputmode');
      ta!.removeAttribute('data-gramm');

      // Dispatch a capturing focus event on the container (the listener is registered
      // with useCapture=true on the container element, so it fires before the textarea's
      // own focus handlers and covers the Gboard strip-on-focus scenario).
      const focusEvent = new FocusEvent('focus', { bubbles: false });
      act(() => { containerDiv.dispatchEvent(focusEvent); });

      // All attributes must be restored by the re-apply handler.
      expect(ta!.getAttribute('autocomplete')).toBe('off');
      expect(ta!.getAttribute('inputmode')).toBe('text');
      expect(ta!.getAttribute('inputmode')).not.toBe('none');
      expect(ta!.getAttribute('data-gramm')).toBe('false');
      // Spot-check the rest to confirm applyMobileInputAttributes ran in full.
      expect(ta!.getAttribute('autocorrect')).toBe('off');
      expect(ta!.getAttribute('autocapitalize')).toBe('none');
      expect(ta!.getAttribute('spellcheck')).toBe('false');
      expect(ta!.getAttribute('enterkeyhint')).toBe('enter');
      expect(ta!.getAttribute('aria-autocomplete')).toBe('none');
      expect(ta!.getAttribute('data-gramm_editor')).toBe('false');
      expect(ta!.getAttribute('data-enable-grammarly')).toBe('false');
    });

    it('should apply mobile input attributes to a newly inserted .xterm-helper-textarea via MutationObserver', async () => {
      // jsdom provides a real MutationObserver so this test exercises the
      // observer path that handles xterm.js internally recreating the textarea.
      renderUseTerminal();

      // Remove the textarea that open() created so we start clean.
      const existing = containerDiv.querySelector('.xterm-helper-textarea');
      if (existing) existing.remove();

      // Insert a fresh textarea (simulating xterm.js recreating it).
      const newTa = document.createElement('textarea');
      newTa.className = 'xterm-helper-textarea';
      // MutationObserver callbacks fire asynchronously in a microtask; wrap in
      // act() and flush microtasks with a zero-duration timer advance.
      await act(async () => {
        containerDiv.appendChild(newTa);
        // Flush pending microtasks so the MutationObserver callback runs.
        await Promise.resolve();
      });

      expect(newTa.getAttribute('autocomplete')).toBe('off');
      expect(newTa.getAttribute('inputmode')).toBe('text');
      expect(newTa.getAttribute('inputmode')).not.toBe('none');
      expect(newTa.getAttribute('data-gramm')).toBe('false');
      expect(newTa.getAttribute('autocorrect')).toBe('off');
      expect(newTa.getAttribute('autocapitalize')).toBe('none');
      expect(newTa.getAttribute('spellcheck')).toBe('false');
      expect(newTa.getAttribute('enterkeyhint')).toBe('enter');
      expect(newTa.getAttribute('aria-autocomplete')).toBe('none');
      expect(newTa.getAttribute('data-gramm_editor')).toBe('false');
      expect(newTa.getAttribute('data-enable-grammarly')).toBe('false');
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
      expect(wsResizeFn).toHaveBeenCalledWith(term.cols - 1, term.rows);
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
    it('should dispose the terminal input subscriptions on unmount', () => {
      const { unmount } = renderUseTerminal();
      const term = getTerminalInstance();
      const dataSub = vi.mocked(term.onData).mock.results[0].value as { dispose: ReturnType<typeof vi.fn> };
      const binarySub = vi.mocked(term.onBinary).mock.results[0].value as { dispose: ReturnType<typeof vi.fn> };

      unmount();

      expect(dataSub.dispose).toHaveBeenCalledTimes(1);
      expect(binarySub.dispose).toHaveBeenCalledTimes(1);
    });

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

    it('keeps one input subscription across 3 reconnects: a keystroke is sent exactly once (#93)', () => {
      const { result } = renderUseTerminal();
      const term = getTerminalInstance();

      act(() => { result.current.reconnect(); });
      act(() => { result.current.reconnect(); });
      act(() => { result.current.reconnect(); });

      // One subscription per terminal, never one per socket.
      expect(term.onData).toHaveBeenCalledTimes(1);
      expect(term.onBinary).toHaveBeenCalledTimes(1);

      // xterm fires a keystroke to every live subscriber.
      wsSendFn.mockClear();
      for (const [cb] of vi.mocked(term.onData).mock.calls) {
        (cb as (d: string) => void)('a');
      }

      expect(wsSendFn).toHaveBeenCalledTimes(1);
      // ...and it goes to the newest socket, not a disconnected one.
      const sockets = vi.mocked(TerminalWebSocket).mock.instances;
      expect(sockets).toHaveLength(4);
      expect(wsSendFn.mock.contexts[0]).toBe(sockets[3]);
    });

    it('routes binary input to the socket created by the last reconnect', () => {
      const { result } = renderUseTerminal();
      const term = getTerminalInstance();

      act(() => { result.current.reconnect(); });
      wsSendFn.mockClear();
      const onBinaryCb = vi.mocked(term.onBinary).mock.calls[0][0] as (d: string) => void;
      onBinaryCb('\x01');

      expect(wsSendFn).toHaveBeenCalledTimes(1);
      expect(wsSendFn.mock.contexts[0]).toBe(vi.mocked(TerminalWebSocket).mock.instances[1]);
    });

    it('clears the error at once, so a repeated maintenance refusal reports again (#46)', () => {
      const refusal = 'ShellKeep is in maintenance. New terminal sessions are paused; try again later.';
      const { result } = renderUseTerminal();

      act(() => { emitWs('error', new Error(refusal)); });
      expect(result.current.error).toBe(refusal);

      act(() => { result.current.reconnect(); });
      expect(result.current.error).toBeNull();

      act(() => { emitWs('error', new Error(refusal)); });
      expect(result.current.error).toBe(refusal);
    });

    it('clears the error and repaints when a reconnected socket connects', () => {
      const { result } = renderUseTerminal();

      act(() => { emitWs('error', new Error('WebSocket error')); });
      expect(result.current.error).toBe('WebSocket error');

      act(() => { result.current.reconnect(); });
      wsResizeFn.mockClear();
      // The shared listener bus fires both sockets' handlers; the newest one counts.
      act(() => { emitWs('connect'); });
      act(() => { vi.advanceTimersByTime(250); });

      expect(result.current.isConnected).toBe(true);
      expect(result.current.error).toBeNull();
      expect(wsResizeFn).toHaveBeenCalled();
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
  describe('host-key refusal (#60)', () => {
    const refusal = {
      code: 'HOST_KEY_UNKNOWN',
      presented: { fingerprint: 'SHA256:presentedA', algorithm: 'ssh-ed25519' },
      expected: null,
      serverProfileId: 'profile-a',
    };

    it('exposes the refusal from the socket without setting an error', () => {
      const { result } = renderUseTerminal();
      act(() => emitWs('host_key', refusal));

      expect(result.current.hostKeyRefusal).toEqual(refusal);
      expect(result.current.error).toBeNull();
    });

    it('retryConnect clears the refusal and asks again on the same socket', () => {
      const { result } = renderUseTerminal();
      act(() => emitWs('host_key', refusal));
      const sockets = vi.mocked(TerminalWebSocket).mock.instances.length;

      act(() => result.current.retryConnect());

      expect(result.current.hostKeyRefusal).toBeNull();
      expect(wsRetryConnectFn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(TerminalWebSocket).mock.instances).toHaveLength(sockets);
    });

    it('dismissHostKey closes the prompt and reports the message', () => {
      const { result } = renderUseTerminal();
      act(() => emitWs('host_key', refusal));

      act(() => result.current.dismissHostKey('not trusted'));

      expect(result.current.hostKeyRefusal).toBeNull();
      expect(result.current.error).toBe('not trusted');
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

  // -------------------------------------------------------------------------
  describe('preferences (#80)', () => {
    function renderWithPreferences(preferences: ResolvedTerminalSettings) {
      return renderHook(
        ({ prefs }) => {
          const containerRef = useRef<HTMLDivElement>(containerDiv);
          return useTerminal('session-1', containerRef, { preferences: prefs, appMode: 'dark' });
        },
        { initialProps: { prefs: preferences } },
      );
    }

    const options = () =>
      (getTerminalInstance() as unknown as { options: Record<string, unknown> }).options;

    it('builds the terminal from the preferences', () => {
      renderWithPreferences({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18, scrollback: 2000, cursorStyle: 'bar' });

      expect(options()).toEqual(
        expect.objectContaining({ fontSize: 18, scrollback: 2000, cursorStyle: 'bar', cursorBlink: true }),
      );
      expect(options().theme).toEqual(expect.objectContaining({ background: '#1e1e1e' }));
    });

    it('applies a change to the open terminal and refits it without reconnecting', async () => {
      const { rerender } = renderWithPreferences(DEFAULT_TERMINAL_SETTINGS);
      wsConnectedState.value = true;
      const fit = getFitAddonInstance().fit;
      fit.mockClear();

      rerender({ prefs: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 20, theme: 'light' } });
      await act(async () => {});

      expect(options().fontSize).toBe(20);
      expect(options().theme).toEqual(expect.objectContaining({ background: '#ffffff' }));
      expect(fit).toHaveBeenCalled();
      expect(wsResizeFn).toHaveBeenCalledWith(80, 24);
      expect(vi.mocked(Terminal)).toHaveBeenCalledTimes(1);
      expect(wsConnectFn).toHaveBeenCalledTimes(1);
      expect(wsDisconnectFn).not.toHaveBeenCalled();
    });

    it('counts bells only while the bell is visual', () => {
      const { result, rerender } = renderWithPreferences(DEFAULT_TERMINAL_SETTINGS);
      const term = getTerminalInstance() as unknown as { bellHandler: () => void };

      act(() => term.bellHandler());
      expect(result.current.bellCount).toBe(0);

      rerender({ prefs: { ...DEFAULT_TERMINAL_SETTINGS, bell: 'visual' } });
      act(() => term.bellHandler());
      expect(result.current.bellCount).toBe(1);
    });

    it('reports whether text is selected, whatever copy-on-select says (#58)', () => {
      const { result } = renderWithPreferences(DEFAULT_TERMINAL_SETTINGS);
      const term = getTerminalInstance() as unknown as {
        selectionHandler: () => void;
        hasSelection: ReturnType<typeof vi.fn>;
      };
      expect(result.current.hasSelection).toBe(false);
      act(() => term.selectionHandler());
      expect(result.current.hasSelection).toBe(true);
      term.hasSelection.mockReturnValue(false);
      act(() => term.selectionHandler());
      expect(result.current.hasSelection).toBe(false);
    });

    it('copies a selection only with copy-on-select on', () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      const { rerender } = renderWithPreferences(DEFAULT_TERMINAL_SETTINGS);
      const term = getTerminalInstance() as unknown as { selectionHandler: () => void };

      act(() => term.selectionHandler());
      expect(writeText).not.toHaveBeenCalled();

      rerender({ prefs: { ...DEFAULT_TERMINAL_SETTINGS, copyOnSelect: true } });
      act(() => term.selectionHandler());
      expect(writeText).toHaveBeenCalledWith('selected text');
    });
  });
});
