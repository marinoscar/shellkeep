import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TerminalWebSocket } from '../services/terminal-ws';
import { api } from '../services/api';

export function useTerminal(sessionId: string, containerRef: RefObject<HTMLDivElement | null>) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<TerminalWebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const token = api.getAccessToken();
    if (!token) {
      setError('Not authenticated');
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Connect WebSocket
    const ws = new TerminalWebSocket(sessionId, token);
    wsRef.current = ws;

    ws.on('connect', () => {
      setIsConnected(true);
      setError(null);
      // Send resize so tmux redraws the screen with the correct dimensions.
      // This triggers tmux to repaint, showing the prompt without executing
      // an extra command (sending \n would cause a double prompt).
      setTimeout(() => {
        ws.resize(terminal.cols, terminal.rows);
      }, 200);
    });

    ws.on('data', (data: Uint8Array) => {
      terminal.write(data);
    });

    ws.on('disconnect', () => {
      setIsConnected(false);
    });

    ws.on('error', (err: Error) => {
      setError(err.message);
    });

    // Terminal input -> WebSocket
    terminal.onData((data: string) => {
      const encoder = new TextEncoder();
      ws.send(encoder.encode(data));
    });

    // Terminal binary -> WebSocket
    terminal.onBinary((data: string) => {
      const buffer = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        buffer[i] = data.charCodeAt(i);
      }
      ws.send(buffer);
    });

    ws.connect();

    // ResizeObserver for terminal fitting
    const container = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.connected) {
        ws.resize(terminal.cols, terminal.rows);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      ws.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId, containerRef]);

  const reconnect = useCallback(() => {
    wsRef.current?.disconnect();
    const token = api.getAccessToken();
    if (token) {
      const ws = new TerminalWebSocket(sessionId, token);
      wsRef.current = ws;

      ws.on('connect', () => setIsConnected(true));
      ws.on('data', (data: Uint8Array) => terminalRef.current?.write(data));
      ws.on('disconnect', () => setIsConnected(false));
      ws.on('error', (err: Error) => setError(err.message));

      terminalRef.current?.onData((data: string) => {
        const encoder = new TextEncoder();
        ws.send(encoder.encode(data));
      });

      ws.connect();
    }
  }, [sessionId]);

  const search = useCallback((term: string) => {
    searchAddonRef.current?.findNext(term);
  }, []);

  return { isConnected, error, reconnect, search, terminal: terminalRef };
}
