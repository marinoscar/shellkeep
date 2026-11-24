import WebSocket from 'ws';

// =============================================================================
// The terminal bridge: this terminal <-> /api/terminal/ws  (issue #72)
// =============================================================================
//
// `sessions attach` puts the local TTY in raw mode and relays it to a tmux
// session through the API's terminal gateway, the same protocol the web client
// speaks (apps/web/src/services/terminal-ws.ts):
//
//   client -> server   text   {type:'auth', token}      (the first frame)
//                      text   {type:'connect', sessionId}
//                      text   {type:'resize', cols, rows}
//                      text   {type:'ping'} / {type:'pong'}
//                      binary terminal input
//   server -> client   text   auth_ok | auth_fail | auth_refreshed | auth_expired
//                      text   session_ready | session_error | session_ended | pong | ping
//                      binary terminal output
//
// THE TOKEN: sent once in the `auth` message, re-sent on a timer so the gateway
// re-validates a personal access token (a revoked token ends the terminal), and
// never anywhere else: not in the URL, not in argv, not in a log line.
//
// THE TTY: raw mode is entered only once the session is ready and is restored on
// every way out: a clean detach, the session ending, a failed handshake, a
// SIGINT/SIGTERM, an exception inside the bridge and, as the last resort, the
// process 'exit' event (which also runs when an uncaught error ends the process).
//
// DETACHING: Ctrl-] then `d`, as in telnet and tmux's own prefix scheme.
// Detaching only closes this socket; the gateway keeps the tmux session
// running and the session stays `active`.
//
// LOGS: with `debug` set the bridge reports frame sizes and control-frame
// types, never terminal bytes and never the token.
// =============================================================================

/** The attach command's exit codes (issue #72). */
export const ATTACH_EXIT = {
  /** Detached, or the session ended. */
  OK: 0,
  /** Interrupted by SIGINT or SIGTERM, or another failure. */
  FAILURE: 1,
  /** stdin is not a terminal. */
  USAGE: 2,
  /** The gateway refused the token (`auth_fail`, `auth_expired`). */
  AUTH: 3,
  /** The session could not be attached (`session_error`) or the connection failed. */
  SESSION: 4,
} as const;

/** Ctrl-], the escape byte. */
export const ESCAPE_BYTE = 0x1d;
/** The byte that follows the escape to detach (`d`). */
export const DETACH_BYTE = 0x64;
/** How often the token is re-sent so the gateway re-validates it (the access JWT lives 15 minutes). */
export const DEFAULT_REAUTH_INTERVAL_MS = 10 * 60 * 1000;

/** The local terminal's input side; `process.stdin` satisfies it. */
export interface TtyInput {
  isTTY?: boolean | undefined;
  setRawMode?(mode: boolean): unknown;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  off(event: 'data', listener: (chunk: Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** The local terminal's output side; `process.stdout` satisfies it. */
export interface TtyOutput {
  write(data: Buffer | string): unknown;
  columns?: number | undefined;
  rows?: number | undefined;
}

/** Signals and process exit; `process` satisfies it. */
export interface ProcessEvents {
  on(event: NodeJS.Signals | 'exit', listener: () => void): unknown;
  off(event: NodeJS.Signals | 'exit', listener: () => void): unknown;
}

/** A WebSocket as the bridge uses it (the `ws` client satisfies it). */
export interface BridgeSocket {
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  send(data: string | Buffer, options?: { binary?: boolean }): unknown;
  close(code?: number): unknown;
  readonly readyState: number;
}

/** What one attach needs. */
export interface BridgeOptions {
  /** `ws(s)://<host>/api/terminal/ws`. */
  url: string;
  /** A personal access token or access JWT; sent only in the `auth` message. */
  token: string;
  sessionId: string;
  stdin: TtyInput;
  stdout: TtyOutput;
  /** Signals and exit; defaults to `process`. */
  processEvents?: ProcessEvents | undefined;
  /** Test seam: builds the socket. */
  createSocket?: ((url: string) => BridgeSocket) | undefined;
  /** Frame sizes and control-frame types go here, never content. */
  debug?: ((line: string) => void) | undefined;
  /** Default {@link DEFAULT_REAUTH_INTERVAL_MS}. */
  reauthIntervalMs?: number | undefined;
  /** Sent in the WebSocket upgrade request, e.g. `shellkeep/0.1.0`. */
  userAgent?: string | undefined;
}

/** How an attach ended. */
export interface BridgeResult {
  code: number;
  /** One line for stderr, absent on a clean detach. */
  message?: string | undefined;
}

/** `https://app.example.test/api` to `wss://app.example.test/api/terminal/ws`. */
export function terminalWsUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/terminal/ws`;
  return url.toString();
}

/**
 * Splits terminal input around the detach sequence.
 *
 * Stateful across chunks, because the two bytes of Ctrl-] `d` can arrive in
 * separate reads. A Ctrl-] followed by anything else is forwarded as typed.
 */
export class EscapeFilter {
  private armed = false;

  /**
   * @param chunk - one read from the terminal.
   * @returns the bytes to forward, and whether the detach sequence completed
   *   (bytes after it are dropped).
   */
  feed(chunk: Buffer): { forward: Buffer; detach: boolean } {
    const out: number[] = [];
    for (const byte of chunk) {
      if (this.armed) {
        this.armed = false;
        if (byte === DETACH_BYTE) return { forward: Buffer.from(out), detach: true };
        out.push(ESCAPE_BYTE, byte);
        continue;
      }
      if (byte === ESCAPE_BYTE) {
        this.armed = true;
        continue;
      }
      out.push(byte);
    }
    return { forward: Buffer.from(out), detach: false };
  }
}

function describeSessionError(code: unknown, error: unknown): string {
  const text = typeof error === 'string' && error.length > 0 ? error : 'the session could not be attached';
  switch (code) {
    case 'NOT_FOUND':
      return 'Session not found. List yours with `shellkeep sessions list`.';
    case 'TERMINATED':
      return 'Session is terminated.';
    case 'HOST_KEY_UNKNOWN':
      return `${text}. Trust the server's host key first (web app: server profile, host key).`;
    case 'HOST_KEY_MISMATCH':
      return `${text}. The server presented a different host key than the trusted one; do not continue unless you changed it.`;
    default:
      return text;
  }
}

/**
 * Attaches this terminal to a session and resolves when the attach ends.
 * Never rejects: a failure is a {@link BridgeResult} with a non-zero code.
 */
export function runBridge(options: BridgeOptions): Promise<BridgeResult> {
  const { stdin, stdout, sessionId } = options;
  const events: ProcessEvents = options.processEvents ?? process;
  const debug = options.debug ?? (() => undefined);

  if (stdin.isTTY !== true || typeof stdin.setRawMode !== 'function') {
    return Promise.resolve({
      code: ATTACH_EXIT.USAGE,
      message: 'sessions attach needs an interactive terminal: stdin is not a TTY.',
    });
  }
  const setRawMode = stdin.setRawMode.bind(stdin);

  return new Promise<BridgeResult>((resolve) => {
    let socket: BridgeSocket;
    try {
      socket =
        options.createSocket?.(options.url) ??
        (new WebSocket(options.url, {
          headers: options.userAgent !== undefined ? { 'User-Agent': options.userAgent } : {},
        }) as unknown as BridgeSocket);
    } catch (error) {
      resolve({ code: ATTACH_EXIT.SESSION, message: `could not open the connection: ${(error as Error).message}` });
      return;
    }

    const filter = new EscapeFilter();
    let rawMode = false;
    let ready = false;
    let settled = false;
    let reauthTimer: NodeJS.Timeout | undefined;

    const sendJson = (frame: Record<string, unknown>): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      debug(`-> ${String(frame.type)}`);
      socket.send(JSON.stringify(frame));
    };

    const sendResize = (): void => {
      // A terminal that reports no size (a pty nobody sized) reads 0x0: send nothing
      // rather than ask the remote pane to shrink to nothing.
      if (typeof stdout.columns === 'number' && typeof stdout.rows === 'number' && stdout.columns > 0 && stdout.rows > 0) {
        sendJson({ type: 'resize', cols: stdout.columns, rows: stdout.rows });
      }
    };

    const onInput = (chunk: Buffer): void => {
      const { forward, detach } = filter.feed(chunk);
      if (forward.length > 0 && socket.readyState === WebSocket.OPEN) {
        debug(`-> binary ${forward.length} bytes`);
        socket.send(forward, { binary: true });
      }
      if (detach) finish({ code: ATTACH_EXIT.OK });
    };

    const onSigwinch = (): void => sendResize();
    const onSigint = (): void => finish({ code: ATTACH_EXIT.FAILURE, message: 'interrupted' });
    const onSigterm = (): void => finish({ code: ATTACH_EXIT.FAILURE, message: 'terminated' });

    // Idempotent; also the process 'exit' hook, the last resort when something
    // outside the bridge ends the process.
    const restoreTty = (): void => {
      if (!rawMode) return;
      rawMode = false;
      try {
        setRawMode(false);
        stdin.pause();
      } catch {
        // The terminal may already be gone; nothing left to restore.
      }
    };

    function finish(result: BridgeResult): void {
      if (settled) return;
      settled = true;
      if (reauthTimer !== undefined) clearInterval(reauthTimer);
      stdin.off('data', onInput);
      events.off('SIGWINCH', onSigwinch);
      events.off('SIGINT', onSigint);
      events.off('SIGTERM', onSigterm);
      events.off('exit', restoreTty);
      restoreTty();
      try {
        socket.close(1000);
      } catch {
        // Already closed.
      }
      resolve(result);
    }

    events.on('SIGWINCH', onSigwinch);
    events.on('SIGINT', onSigint);
    events.on('SIGTERM', onSigterm);
    events.on('exit', restoreTty);

    socket.on('open', () => {
      debug('open');
      sendJson({ type: 'auth', token: options.token });
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        debug(`<- binary ${data.length} bytes`);
        stdout.write(data);
        return;
      }
      let frame: { type?: unknown; error?: unknown; code?: unknown; reason?: unknown };
      try {
        frame = JSON.parse(data.toString('utf8')) as typeof frame;
      } catch {
        debug(`<- text ${data.length} bytes (not JSON)`);
        return;
      }
      debug(`<- ${String(frame.type)}`);
      switch (frame.type) {
        case 'auth_ok':
          sendJson({ type: 'connect', sessionId });
          break;
        case 'auth_refreshed':
          break;
        case 'auth_fail':
          finish({
            code: ATTACH_EXIT.AUTH,
            message: `authentication failed${typeof frame.reason === 'string' ? ` (${frame.reason})` : ''}. Run \`shellkeep login\` again.`,
          });
          break;
        case 'auth_expired':
          finish({ code: ATTACH_EXIT.AUTH, message: 'the access token expired. Run `shellkeep login` again.' });
          break;
        case 'session_ready':
          ready = true;
          try {
            setRawMode(true);
            rawMode = true;
            stdin.resume();
          } catch (error) {
            finish({ code: ATTACH_EXIT.FAILURE, message: `could not enter raw mode: ${(error as Error).message}` });
            return;
          }
          stdin.on('data', onInput);
          sendResize();
          reauthTimer = setInterval(
            () => sendJson({ type: 'auth', token: options.token }),
            options.reauthIntervalMs ?? DEFAULT_REAUTH_INTERVAL_MS,
          );
          reauthTimer.unref();
          break;
        case 'session_error':
          finish({ code: ATTACH_EXIT.SESSION, message: describeSessionError(frame.code, frame.error) });
          break;
        case 'session_ended':
          finish({ code: ATTACH_EXIT.OK, message: 'session ended' });
          break;
        case 'ping':
          sendJson({ type: 'pong' });
          break;
        default:
          break;
      }
    });

    socket.on('error', (error) => {
      finish({ code: ATTACH_EXIT.SESSION, message: `connection failed: ${error.message}` });
    });

    socket.on('close', () => {
      finish({
        code: ATTACH_EXIT.SESSION,
        message: ready ? 'connection closed by the server' : 'connection closed before the session was ready',
      });
    });
  });
}
