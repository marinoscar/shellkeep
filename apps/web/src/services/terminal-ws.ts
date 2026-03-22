export type TerminalWsEventType = 'data' | 'connect' | 'disconnect' | 'error';

export class TerminalWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Map<TerminalWsEventType, Set<Function>> = new Map();
  private _connected = false;

  constructor(
    private sessionId: string,
    private token: string,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/terminal/ws`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // Send auth message
      this.ws!.send(JSON.stringify({ type: 'auth', token: this.token }));
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary data = terminal output
        this.emit('data', new Uint8Array(event.data));
        return;
      }

      // Text data = control message
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'auth_ok':
            // Now connect to session
            this.ws!.send(JSON.stringify({ type: 'connect', sessionId: this.sessionId }));
            break;
          case 'auth_fail':
            this.emit('error', new Error(message.reason || 'Authentication failed'));
            this.disconnect();
            break;
          case 'session_ready':
            this._connected = true;
            this.reconnectAttempts = 0;
            this.startPing();
            this.emit('connect', null);
            break;
          case 'session_error':
            this.emit('error', new Error(message.error || 'Session error'));
            break;
          case 'session_ended':
            this._connected = false;
            this.emit('disconnect', message.reason);
            break;
          case 'pong':
            // Heartbeat response, no action needed
            break;
        }
      } catch {
        // If parse fails, treat as binary data
        const encoder = new TextEncoder();
        this.emit('data', encoder.encode(event.data));
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.stopPing();
      this.emit('disconnect', 'connection_closed');
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      this.emit('error', new Error('WebSocket error'));
    };
  }

  disconnect(): void {
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
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

  on(event: TerminalWsEventType, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: TerminalWsEventType, callback: Function): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: TerminalWsEventType, data: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  private startPing(): void {
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
