/**
 * A fake terminal WebSocket for the visual harness (issue #81).
 *
 * `TerminalWebSocket` (`src/services/terminal-ws.ts`) talks to the gateway with
 * one `new WebSocket(...)`. The harness replaces the global constructor with
 * this class, so a terminal pane connects, "attaches" to its session and shows
 * a FIXED byte stream, with no gateway, SSH server or tmux behind it.
 *
 * The protocol is the gateway's, in the order the real client expects it:
 *
 *   client `open`            -> client sends `{type:'auth', token}`
 *   server `{type:'auth_ok'}`    -> client sends `{type:'connect', sessionId}`
 *   server `{type:'session_ready'}` -> then the binary replay below
 *
 * What it deliberately does NOT do, so a screenshot never depends on timing:
 *
 *   - It never answers `ping`: the status bar's latency stays empty instead of
 *     showing a round trip that differs from run to run.
 *   - It never echoes input and ignores `resize`.
 *   - It never closes, so the client never reconnects.
 *
 * Every stream is a constant: same bytes, same colours, no clock, no host name
 * that is not a placeholder.
 */

const ESC = '\u001b';
const reset = `${ESC}[0m`;
const green = (text: string): string => `${ESC}[1;32m${text}${reset}`;
const blue = (text: string): string => `${ESC}[1;34m${text}${reset}`;
const yellow = (text: string): string => `${ESC}[33m${text}${reset}`;
const red = (text: string): string => `${ESC}[31m${text}${reset}`;
const dim = (text: string): string => `${ESC}[2m${text}${reset}`;

function prompt(host: string, command: string): string {
  return `${green(`person-a@${host}`)}:${blue('~/app')}$ ${command}\r\n`;
}

/** The replay of the first session: a build and a directory listing. */
const SCRIPT_ALPHA = [
  prompt('server-a', 'ls -la'),
  'total 48\r\n',
  `drwxr-xr-x  6 person-a person-a 4096 Jan 15 12:00 ${blue('.')}\r\n`,
  `drwxr-xr-x  4 person-a person-a 4096 Jan 15 11:58 ${blue('..')}\r\n`,
  `-rw-r--r--  1 person-a person-a  312 Jan 15 11:59 package.json\r\n`,
  `-rwxr-xr-x  1 person-a person-a  846 Jan 15 11:59 ${green('deploy.sh')}\r\n`,
  `drwxr-xr-x  3 person-a person-a 4096 Jan 15 11:59 ${blue('src')}\r\n`,
  prompt('server-a', 'npm run build'),
  `${dim('> app@1.0.0 build')}\r\n`,
  `${yellow('warn')}  3 chunks are larger than 500 kB\r\n`,
  `${green('ok')}    built in 4.2s\r\n`,
  `${green('person-a@server-a')}:${blue('~/app')}$ `,
].join('');

/** The replay of any other session: a service check with one failure. */
const SCRIPT_BETA = [
  prompt('server-b', 'systemctl status worker'),
  `${green('●')} worker.service - Background worker\r\n`,
  `     Loaded: loaded (/etc/systemd/system/worker.service; enabled)\r\n`,
  `     Active: ${green('active (running)')} since Mon 2025-01-13 08:00:00 UTC; 2 days ago\r\n`,
  prompt('server-b', 'tail -n 3 /var/log/worker.log'),
  `[info]  job 1041 finished\r\n`,
  `${red('[error]')} job 1042 failed: connection refused\r\n`,
  `[info]  job 1043 queued\r\n`,
  `${green('person-a@server-b')}:${blue('~/app')}$ `,
].join('');

/** The bytes a session's pane shows once it is attached. */
export function scriptFor(sessionId: string): string {
  return sessionId.endsWith('alpha') ? SCRIPT_ALPHA : SCRIPT_BETA;
}

type Handler = ((event: never) => unknown) | null;

/** The slice of the WebSocket API `TerminalWebSocket` uses. */
class FakeTerminalSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  binaryType: 'blob' | 'arraybuffer' = 'blob';
  readyState = 0;
  readonly url: string;
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;

  constructor(url: string | URL) {
    this.url = String(url);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      (this.onopen as ((event: Event) => unknown) | null)?.(new Event('open'));
    }, 0);
  }

  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void {
    if (typeof data !== 'string') return; // keystrokes are ignored
    let message: { type?: string; sessionId?: string };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === 'auth') {
      this.reply({ type: 'auth_ok' });
    } else if (message.type === 'connect' && message.sessionId) {
      this.reply({ type: 'session_ready' });
      const bytes = new TextEncoder().encode(scriptFor(message.sessionId));
      setTimeout(() => this.replyBinary(bytes), 20);
    }
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  private reply(message: object): void {
    setTimeout(() => {
      if (this.readyState !== 1) return;
      (this.onmessage as ((event: MessageEvent) => unknown) | null)?.(
        new MessageEvent('message', { data: JSON.stringify(message) }),
      );
    }, 0);
  }

  private replyBinary(bytes: Uint8Array): void {
    if (this.readyState !== 1) return;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    (this.onmessage as ((event: MessageEvent) => unknown) | null)?.(
      new MessageEvent('message', { data: buffer }),
    );
  }
}

/** Replace the page's `WebSocket` with the fake. Call before anything connects. */
export function installFakeTerminalWs(): void {
  (window as unknown as { WebSocket: unknown }).WebSocket = FakeTerminalSocket;
}
