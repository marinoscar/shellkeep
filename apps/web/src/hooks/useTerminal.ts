import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TerminalWebSocket } from '../services/terminal-ws';
import { api } from '../services/api';
import type { HostKeyRefusal } from '../types/terminal';
import { DEFAULT_TERMINAL_SETTINGS, type ResolvedTerminalSettings } from '../lib/terminal/settings';
import {
  applyTerminalAppearance,
  ensureTerminalFont,
  playTerminalBell,
  terminalAppearanceOptions,
  type AppColorMode,
} from '../lib/terminal/appearance';
import { createFileLinkProvider, type TerminalFileLinkSource } from '../lib/terminal/file-link-provider';
import type { TerminalInputModifiers } from '../lib/terminal/keys/modifiedInput';
import { looksLikeHardwareKey } from '../lib/terminal/keys/hardwareKeys';
import { readKeyboardInset } from './useKeyboardInset';

/**
 * Apply attributes to the xterm.js helper textarea that suppress the
 * Android (Gboard) predictive-text / autocorrect suggestion strip.
 *
 * Why each attribute matters:
 *  - autocomplete / autocorrect / autocapitalize / spellcheck: standard
 *    HTML hints that well-behaved keyboards respect.
 *  - inputmode="text": explicitly requests the standard alphanumeric keyboard
 *    so the soft keyboard is raised on focus. NOTE: there is no fully reliable
 *    web attribute that force-disables Gboard's predictive suggestion strip
 *    while keeping the keyboard visible; these attributes minimize
 *    autocorrect/capitalization but the suggestion strip may still appear on
 *    some Gboard versions.
 *  - enterkeyhint: nudges Gboard to show "enter" key rather than "next/done",
 *    reinforcing the terminal-input nature of the field.
 *  - aria-autocomplete: additional hint so assistive technologies don't
 *    offer completions either.
 *  - data-gramm / data-gramm_editor / data-enable-grammarly: disables the
 *    Grammarly browser extension, which ignores autocorrect="off" entirely.
 */
function applyMobileInputAttributes(textarea: HTMLTextAreaElement): void {
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocapitalize', 'none');
  textarea.setAttribute('spellcheck', 'false');
  textarea.setAttribute('inputmode', 'text');
  textarea.setAttribute('enterkeyhint', 'enter');
  textarea.setAttribute('aria-autocomplete', 'none');
  textarea.setAttribute('data-gramm', 'false');
  textarea.setAttribute('data-gramm_editor', 'false');
  textarea.setAttribute('data-enable-grammarly', 'false');
}

/**
 * Open a socket for `sessionId` and wire its events to the terminal and the
 * hook's state. Terminal input is NOT wired here: the hook subscribes to it
 * once per terminal and routes it to the current socket (issue #93).
 */
function openSocket(
  sessionId: string,
  terminal: Terminal,
  setIsConnected: (connected: boolean) => void,
  setError: (error: string | null) => void,
  setHostKeyRefusal: (refusal: HostKeyRefusal | null) => void,
  setLatencyMs: (latency: number | null) => void,
): TerminalWebSocket {
  // The socket reads the session's current access token on every (re)connect
  // and re-authenticates in-band after each refresh (#47).
  const ws = new TerminalWebSocket(sessionId);

  ws.on('connect', () => {
    setIsConnected(true);
    setError(null);
    // Force tmux to repaint by toggling dimensions.
    // If the size matches what tmux already has, it won't redraw.
    // Sending cols-1 first forces a size change, then the real
    // size triggers a full repaint with correct dimensions.
    setTimeout(() => {
      ws.resize(terminal.cols - 1, terminal.rows);
      setTimeout(() => {
        ws.resize(terminal.cols, terminal.rows);
      }, 50);
    }, 200);
  });

  ws.on('data', (data: Uint8Array) => {
    terminal.write(data);
  });

  ws.on('disconnect', () => {
    setIsConnected(false);
    setLatencyMs(null);
  });

  // The heartbeat's round trip (the status bar, #77).
  ws.on('latency', (latency: number) => {
    setLatencyMs(latency);
  });

  ws.on('error', (err: Error) => {
    setError(err.message);
  });

  // An unknown or changed host key (#60): the view prompts the user.
  ws.on('host_key', (refusal: HostKeyRefusal) => {
    setHostKeyRefusal(refusal);
  });

  return ws;
}

/** How a session terminal looks and behaves: the user's preferences (#80). */
export interface TerminalAppearance {
  preferences: ResolvedTerminalSettings;
  /** The app's colour mode, which the `follow-app` theme follows. */
  appMode: AppColorMode;
  /**
   * Keys the app handles itself (#57: the AI assist shortcut). Return `true` to keep the
   * key from reaching the terminal and so the PTY; the page's own listener acts on it.
   */
  isReservedKey?: (event: KeyboardEvent) => boolean;
}

/** What a session terminal does beyond drawing the session. */
export interface TerminalOptions {
  /**
   * File references in the output (#155): where existence is checked and what a click does.
   * `null` or absent: no file links. Read on every hover, so it may change without a reconnect.
   */
  fileLinks?: TerminalFileLinkSource | null;
  /**
   * The key bar's armed or locked modifiers (#166): typed input passes through it
   * before it is sent, so Ctrl armed + `r` sends Ctrl+R. Read on every keystroke.
   */
  inputModifiers?: TerminalInputModifiers | null;
}

const DEFAULT_APPEARANCE: TerminalAppearance = {
  preferences: DEFAULT_TERMINAL_SETTINGS,
  appMode: 'dark',
};

export function useTerminal(
  sessionId: string,
  containerRef: RefObject<HTMLDivElement | null>,
  appearance: TerminalAppearance = DEFAULT_APPEARANCE,
  options: TerminalOptions = {},
) {
  // Read by the terminal's handlers (bell, selection) and at construction, so a
  // preference change never re-creates the terminal or its socket.
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const fileLinksRef = useRef(options.fileLinks ?? null);
  fileLinksRef.current = options.fileLinks ?? null;
  const inputModifiersRef = useRef(options.inputModifiers ?? null);
  inputModifiersRef.current = options.inputModifiers ?? null;
  const [bellCount, setBellCount] = useState(0);
  // Whether text is selected (#58: the floating Explain chip).
  const [hasSelection, setHasSelection] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostKeyRefusal, setHostKeyRefusal] = useState<HostKeyRefusal | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [size, setSize] = useState<{ cols: number; rows: number } | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<TerminalWebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    if (!api.getAccessToken()) {
      setError('Not authenticated');
      return;
    }

    const terminal = new Terminal({
      // Font, size, line height, cursor, scrollback and theme: the user's (#80).
      ...terminalAppearanceOptions(
        appearanceRef.current.preferences,
        appearanceRef.current.appMode,
      ),
      letterSpacing: 0,
      convertEol: true,
    });

    // A hardware key with a real Ctrl, Alt or Meta (#166): it wins over the key
    // bar's one-shots, which are released, and the data it produces (sent
    // synchronously by xterm inside this keydown) is not modified again.
    // A plain hardware key (#170: a physical key while no on-screen keyboard is
    // up) takes the armed one-shots only; a locked soft modifier is for soft keys.
    let keySource: 'chord' | 'hardware' | null = null;
    let keySourceTimer: ReturnType<typeof setTimeout> | null = null;
    const markKeySource = (source: 'chord' | 'hardware') => {
      keySource = source;
      if (keySourceTimer !== null) clearTimeout(keySourceTimer);
      keySourceTimer = setTimeout(() => {
        keySource = null;
        keySourceTimer = null;
      }, 0);
    };

    // App shortcuts never reach the PTY (#57).
    terminal.attachCustomKeyEventHandler?.((event) => {
      if (event.type === 'keydown' && appearanceRef.current.isReservedKey?.(event)) return false;
      if (event.type === 'keydown' && (event.ctrlKey || event.altKey || event.metaKey)) {
        inputModifiersRef.current?.onHardwareChord();
        markKeySource('chord');
      } else if (event.type === 'keydown' && looksLikeHardwareKey(event) && readKeyboardInset() === 0) {
        markKeySource('hardware');
      }
      return true;
    });

    // The bell (#80): a flash the view draws, or a short beep.
    const bellSubscription = terminal.onBell?.(() => {
      const { bell } = appearanceRef.current.preferences;
      if (bell === 'visual') setBellCount((count) => count + 1);
      else if (bell === 'sound') playTerminalBell();
    });

    // Copy on select (#80): a finished selection goes to the clipboard.
    const selectionSubscription = terminal.onSelectionChange?.(() => {
      const selected = terminal.hasSelection();
      setHasSelection(selected);
      if (!appearanceRef.current.preferences.copyOnSelect || !selected) return;
      const text = terminal.getSelection();
      if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    // File references (#155): beside the URL links; inert while no source is given.
    const fileLinkSubscription = terminal.registerLinkProvider?.(
      createFileLinkProvider(terminal, () => fileLinksRef.current),
    );

    terminal.open(containerRef.current);

    // Apply mobile-keyboard suppression attributes to the helper textarea.
    // We apply them immediately after open() and then keep them in sync via:
    //  1. A MutationObserver — xterm.js may recreate the textarea on refit or
    //     internal re-render; the observer catches any newly inserted textarea.
    //  2. A focus listener — some keyboards (Gboard) strip unknown attributes
    //     when the field gains focus; re-applying on focus prevents that.
    const container = containerRef.current;

    const applyToCurrentTextarea = () => {
      const ta = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      if (ta) applyMobileInputAttributes(ta);
    };

    // Apply immediately — the textarea exists right after terminal.open().
    applyToCurrentTextarea();

    // MutationObserver: watch for the textarea being replaced / re-inserted.
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLTextAreaElement && node.classList.contains('xterm-helper-textarea')) {
            applyMobileInputAttributes(node);
          } else if (node instanceof HTMLElement) {
            // Check descendants in case xterm wraps the textarea in a div.
            const nested = node.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
            if (nested) applyMobileInputAttributes(nested);
          }
        }
      }
    });
    mutationObserver.observe(container, { childList: true, subtree: true });

    // Focus listener: re-apply attributes every time the textarea is focused,
    // because Gboard is known to strip or reset them when the field activates.
    const handleFocus = () => { applyToCurrentTextarea(); };
    container.addEventListener('focus', handleFocus, true /* capture */);

    fitAddon.fit();
    setSize({ cols: terminal.cols, rows: terminal.rows });
    const resizeSubscription = terminal.onResize?.(({ cols, rows }) => setSize({ cols, rows }));

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    const ws = openSocket(sessionId, terminal, setIsConnected, setError, setHostKeyRefusal, setLatencyMs);
    wsRef.current = ws;

    // Terminal input -> the CURRENT socket. Subscribed once per terminal, so a
    // reconnect (which replaces the socket) never adds a second subscription
    // and a keystroke is sent exactly once (issue #93).
    const encoder = new TextEncoder();
    const dataSubscription = terminal.onData((data: string) => {
      // The key bar's modifiers apply to typed keys (#166), never to a hardware
      // chord; to a plain hardware key only the armed one-shots apply (#170).
      const modifiers = inputModifiersRef.current;
      const out =
        modifiers && keySource !== 'chord'
          ? modifiers.transform(
              data,
              terminal.modes?.applicationCursorKeysMode ?? false,
              keySource === 'hardware' ? 'hardware' : 'soft',
            )
          : data;
      wsRef.current?.send(encoder.encode(out));
    });

    // Terminal binary -> the current socket
    const binarySubscription = terminal.onBinary((data: string) => {
      const buffer = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        buffer[i] = data.charCodeAt(i);
      }
      wsRef.current?.send(buffer);
    });

    ws.connect();

    // ResizeObserver for terminal fitting
    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (fitTimer !== null) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        fitAddon.fit();
        const current = wsRef.current;
        if (current?.connected) {
          current.resize(terminal.cols, terminal.rows);
        }
        fitTimer = null;
      }, 100);
    });
    resizeObserver.observe(container);

    return () => {
      if (fitTimer !== null) clearTimeout(fitTimer);
      if (keySourceTimer !== null) clearTimeout(keySourceTimer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener('focus', handleFocus, true);
      dataSubscription?.dispose();
      binarySubscription?.dispose();
      bellSubscription?.dispose();
      selectionSubscription?.dispose();
      resizeSubscription?.dispose();
      fileLinkSubscription?.dispose();
      wsRef.current?.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId, containerRef]);

  // A preference change applies to the open terminal in place (#80): the
  // options change, the terminal is refitted and tmux is told the new size.
  // The socket stays open. A bundled font is loaded before it is measured.
  const { preferences, appMode } = appearance;
  useEffect(() => {
    let cancelled = false;
    void ensureTerminalFont(preferences.fontFamily).then(() => {
      const terminal = terminalRef.current;
      if (cancelled || !terminal) return;
      if (!applyTerminalAppearance(terminal, preferences, appMode)) return;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // A terminal that is not laid out yet is fitted by its ResizeObserver.
      }
      const ws = wsRef.current;
      if (ws?.connected) ws.resize(terminal.cols, terminal.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences, appMode]);

  /**
   * Replace the socket with a fresh one (the maintenance alert's Retry, #46).
   * The error is cleared first so a repeat refusal reports again.
   */
  const reconnect = useCallback(() => {
    wsRef.current?.disconnect();
    setError(null);
    setHostKeyRefusal(null);
    const terminal = terminalRef.current;
    if (api.getAccessToken() && terminal) {
      // Only the socket is replaced: the terminal's single input subscription
      // already routes to whatever `wsRef.current` is.
      const ws = openSocket(sessionId, terminal, setIsConnected, setError, setHostKeyRefusal, setLatencyMs);
      wsRef.current = ws;
      ws.connect();
    }
  }, [sessionId]);

  /**
   * The host key was trusted (#60): ask for the session again on the same
   * socket (the gateway kept it open after the refusal).
   */
  const retryConnect = useCallback(() => {
    setHostKeyRefusal(null);
    setError(null);
    if (wsRef.current) {
      wsRef.current.retryConnect();
    } else {
      reconnect();
    }
  }, [reconnect]);

  /** The user declined the host-key prompt: close it and report `message`. */
  const dismissHostKey = useCallback((message: string) => {
    setHostKeyRefusal(null);
    setError(message);
  }, []);

  const search = useCallback((term: string) => {
    searchAddonRef.current?.findNext(term);
  }, []);

  const sendInput = useCallback((data: string) => {
    const encoder = new TextEncoder();
    wsRef.current?.send(encoder.encode(data));
  }, []);

  return {
    isConnected,
    error,
    reconnect,
    search,
    terminal: terminalRef,
    sendInput,
    hostKeyRefusal,
    retryConnect,
    dismissHostKey,
    /** The heartbeat's last round trip in ms, or `null` while not connected (#77). */
    latencyMs,
    /** The terminal's columns and rows after the last fit, or `null` before the first. */
    size,
    /** Counts bells while `bell` is `visual`, so the view can flash (#80). */
    bellCount,
    /** Whether terminal text is selected right now (#58). */
    hasSelection,
  };
}
