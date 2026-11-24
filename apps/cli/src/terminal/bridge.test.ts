import { describe, expect, it, vi } from 'vitest';

import { FakeProcess, FakeSocket, FakeStdin, FakeStdout } from '../__support__/fakes.js';

import {
  ATTACH_EXIT,
  DEFAULT_REAUTH_INTERVAL_MS,
  EscapeFilter,
  runBridge,
  terminalWsUrl,
  type BridgeOptions,
} from './bridge.js';

const SESSION = '5a1e6c0e-6b0e-4d52-9d6e-1f5d0f6f3a11';
const TOKEN = 'pat_example_token_value';

function setup(overrides: Partial<BridgeOptions> = {}) {
  const socket = new FakeSocket();
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const events = new FakeProcess();
  const debug: string[] = [];
  const promise = runBridge({
    url: 'wss://app.example.test/api/terminal/ws',
    token: TOKEN,
    sessionId: SESSION,
    stdin,
    stdout,
    processEvents: events,
    createSocket: () => socket,
    debug: (line) => debug.push(line),
    ...overrides,
  });
  return { socket, stdin, stdout, events, debug, promise };
}

/** Runs the handshake up to `session_ready`. */
function ready(socket: FakeSocket): void {
  socket.emit('open');
  socket.serverText({ type: 'auth_ok' });
  socket.serverText({ type: 'session_ready', sessionId: SESSION });
}

describe('terminalWsUrl', () => {
  it('maps the API base URL onto the gateway path with the matching ws scheme', () => {
    expect(terminalWsUrl('https://app.example.test/api')).toBe('wss://app.example.test/api/terminal/ws');
    expect(terminalWsUrl('http://localhost:8323/api')).toBe('ws://localhost:8323/api/terminal/ws');
  });
});

describe('EscapeFilter', () => {
  it('forwards ordinary bytes untouched', () => {
    expect(new EscapeFilter().feed(Buffer.from('ls -l\r'))).toEqual({ forward: Buffer.from('ls -l\r'), detach: false });
  });

  it('detects Ctrl-] d and drops what follows', () => {
    const result = new EscapeFilter().feed(Buffer.from([0x61, 0x1d, 0x64, 0x62]));
    expect(result.detach).toBe(true);
    expect(result.forward).toEqual(Buffer.from('a'));
  });

  it('detects the sequence across two reads', () => {
    const filter = new EscapeFilter();
    expect(filter.feed(Buffer.from([0x1d]))).toEqual({ forward: Buffer.alloc(0), detach: false });
    expect(filter.feed(Buffer.from('d')).detach).toBe(true);
  });

  it('forwards Ctrl-] followed by anything else as typed', () => {
    const result = new EscapeFilter().feed(Buffer.from([0x1d, 0x78]));
    expect(result).toEqual({ forward: Buffer.from([0x1d, 0x78]), detach: false });
  });
});

describe('the handshake', () => {
  it('sends auth first, then connect after auth_ok, and only then enters raw mode', async () => {
    const { socket, stdin, promise } = setup();

    socket.emit('open');
    expect(socket.frames()).toEqual([{ type: 'auth', token: TOKEN }]);
    expect(stdin.raw).toEqual([]);

    socket.serverText({ type: 'auth_ok' });
    expect(socket.frames()[1]).toEqual({ type: 'connect', sessionId: SESSION });
    expect(stdin.raw).toEqual([]);

    socket.serverText({ type: 'session_ready', sessionId: SESSION });
    expect(stdin.raw).toEqual([true]);
    expect(stdin.paused).toBe(false);

    stdin.type('\x1dd');
    await expect(promise).resolves.toEqual({ code: ATTACH_EXIT.OK });
  });

  it('sends the terminal size right after the session is ready', async () => {
    const { socket, stdin, promise } = setup();
    ready(socket);

    expect(socket.frames().at(-1)).toEqual({ type: 'resize', cols: 100, rows: 30 });

    stdin.type('\x1dd');
    await promise;
  });

  it('never puts the token anywhere but the auth frames', async () => {
    const { socket, stdin, stdout, debug, promise } = setup();
    ready(socket);
    stdin.type('echo hello\r');
    socket.serverBinary('hello\r\n');
    stdin.type('\x1dd');
    await promise;

    const nonAuth = socket.frames().filter((frame) => frame.type !== 'auth');
    expect(JSON.stringify(nonAuth)).not.toContain(TOKEN);
    expect(socket.binary().toString()).not.toContain(TOKEN);
    expect(stdout.text()).not.toContain(TOKEN);
    expect(debug.join('\n')).not.toContain(TOKEN);
  });
});

describe('raw bytes', () => {
  it('forwards stdin as binary frames and writes received binary frames to stdout', async () => {
    const { socket, stdin, stdout, promise } = setup();
    ready(socket);

    stdin.type('ls\r');
    socket.serverBinary('file-a  file-b\r\n');

    expect(socket.sent.filter((entry) => entry.binary).map((entry) => entry.data.toString())).toEqual(['ls\r']);
    expect(stdout.text()).toBe('file-a  file-b\r\n');

    stdin.type('\x1dd');
    await promise;
  });

  it('passes Ctrl-C through to the remote instead of ending the attach', async () => {
    const { socket, stdin, promise } = setup();
    ready(socket);

    stdin.type(Buffer.from([0x03]));
    expect(socket.binary()).toEqual(Buffer.from([0x03]));

    stdin.type('\x1dd');
    await promise;
  });

  it('logs frame sizes and types, never content', async () => {
    const { socket, stdin, debug, promise } = setup();
    ready(socket);
    stdin.type('secret-command\r');
    socket.serverBinary('secret-output\r\n');
    stdin.type('\x1dd');
    await promise;

    const log = debug.join('\n');
    expect(log).toContain('-> binary 15 bytes');
    expect(log).toContain('<- binary 15 bytes');
    expect(log).not.toContain('secret');
  });
});

describe('resize and keep-alive', () => {
  it('sends a resize on SIGWINCH with the current size', async () => {
    const { socket, stdin, stdout, events, promise } = setup();
    ready(socket);

    stdout.columns = 140;
    stdout.rows = 50;
    events.emit('SIGWINCH');

    expect(socket.frames().at(-1)).toEqual({ type: 'resize', cols: 140, rows: 50 });

    stdin.type('\x1dd');
    await promise;
  });

  it('answers a ping frame with a pong', async () => {
    const { socket, stdin, promise } = setup();
    ready(socket);

    socket.serverText({ type: 'ping' });
    expect(socket.frames().at(-1)).toEqual({ type: 'pong' });

    stdin.type('\x1dd');
    await promise;
  });

  it('re-sends the token on a timer so the gateway re-validates it', async () => {
    vi.useFakeTimers();
    try {
      const { socket, stdin, promise } = setup({ reauthIntervalMs: 1000 });
      ready(socket);
      const before = socket.frames().filter((frame) => frame.type === 'auth').length;

      vi.advanceTimersByTime(2500);
      expect(socket.frames().filter((frame) => frame.type === 'auth').length).toBe(before + 2);

      stdin.type('\x1dd');
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the re-auth interval below the 15 minute access token lifetime', () => {
    expect(DEFAULT_REAUTH_INTERVAL_MS).toBeLessThan(15 * 60 * 1000);
  });
});

describe('detaching', () => {
  it('closes the socket, restores the TTY and exits 0 on Ctrl-] d', async () => {
    const { socket, stdin, events, promise } = setup();
    ready(socket);

    stdin.type('\x1dd');

    await expect(promise).resolves.toEqual({ code: 0 });
    expect(socket.closed).toBe(true);
    expect(stdin.raw).toEqual([true, false]);
    expect(stdin.paused).toBe(true);
    expect(events.listenersOf('SIGWINCH')).toBe(0);
    expect(events.listenersOf('exit')).toBe(0);
  });

  it('exits 0 when the session ends', async () => {
    const { socket, stdin, promise } = setup();
    ready(socket);

    socket.serverText({ type: 'session_ended', reason: 'terminated' });

    await expect(promise).resolves.toEqual({ code: 0, message: 'session ended' });
    expect(stdin.raw).toEqual([true, false]);
  });
});

describe('failures', () => {
  it('exits 3 on auth_fail and never enters raw mode', async () => {
    const { socket, stdin, promise } = setup();
    socket.emit('open');
    socket.serverText({ type: 'auth_fail', reason: 'Invalid token' });

    const result = await promise;
    expect(result.code).toBe(ATTACH_EXIT.AUTH);
    expect(result.message).toContain('shellkeep login');
    expect(result.message).not.toContain(TOKEN);
    expect(stdin.raw).toEqual([]);
  });

  it('exits 3 when the token expires mid-session and restores the TTY', async () => {
    const { socket, stdin, promise } = setup();
    ready(socket);

    socket.serverText({ type: 'auth_expired' });

    expect((await promise).code).toBe(ATTACH_EXIT.AUTH);
    expect(stdin.raw).toEqual([true, false]);
  });

  it('exits 4 on session_error with a hint for each known code', async () => {
    const codes: Array<[string, string]> = [
      ['NOT_FOUND', 'sessions list'],
      ['TERMINATED', 'terminated'],
      ['HOST_KEY_UNKNOWN', 'host key'],
      ['HOST_KEY_MISMATCH', 'different host key'],
    ];
    for (const [code, expected] of codes) {
      const { socket, promise } = setup();
      socket.emit('open');
      socket.serverText({ type: 'auth_ok' });
      socket.serverText({ type: 'session_error', error: 'refused', code });
      const result = await promise;
      expect(result.code).toBe(ATTACH_EXIT.SESSION);
      expect(result.message).toContain(expected);
    }
  });

  it('exits 4 on a connection error, and on a close before the session is ready', async () => {
    const first = setup();
    first.socket.emit('error', new Error('connect ECONNREFUSED'));
    expect(await first.promise).toMatchObject({ code: ATTACH_EXIT.SESSION });

    const second = setup();
    second.socket.emit('open');
    second.socket.emit('close');
    expect(await second.promise).toMatchObject({ code: ATTACH_EXIT.SESSION });
  });

  it('refuses to run when stdin is not a TTY: exit 2, no socket opened', async () => {
    const createSocket = vi.fn(() => new FakeSocket());
    const stdin = new FakeStdin();
    stdin.isTTY = undefined;

    const result = await runBridge({
      url: 'wss://app.example.test/api/terminal/ws',
      token: TOKEN,
      sessionId: SESSION,
      stdin,
      stdout: new FakeStdout(),
      processEvents: new FakeProcess(),
      createSocket,
    });

    expect(result.code).toBe(ATTACH_EXIT.USAGE);
    expect(createSocket).not.toHaveBeenCalled();
    expect(stdin.raw).toEqual([]);
  });
});

describe('restoring the TTY', () => {
  it('restores it on SIGINT', async () => {
    const { socket, stdin, events, promise } = setup();
    ready(socket);

    events.emit('SIGINT');

    expect((await promise).code).toBe(ATTACH_EXIT.FAILURE);
    expect(stdin.raw).toEqual([true, false]);
  });

  it('restores it on SIGTERM', async () => {
    const { socket, stdin, events, promise } = setup();
    ready(socket);

    events.emit('SIGTERM');

    expect((await promise).code).toBe(ATTACH_EXIT.FAILURE);
    expect(stdin.raw).toEqual([true, false]);
  });

  it('restores it when the process exits underneath the bridge (an uncaught error)', () => {
    const { socket, stdin, events } = setup();
    ready(socket);
    expect(stdin.raw).toEqual([true]);

    events.emit('exit');

    expect(stdin.raw).toEqual([true, false]);
  });

  it('restores it when raw mode cannot be entered', async () => {
    const stdin = new FakeStdin();
    stdin.setRawMode = (mode: boolean) => {
      stdin.raw.push(mode);
      if (mode) throw new Error('EIO');
      return stdin;
    };
    const { socket, promise } = setup({ stdin });

    ready(socket);

    const result = await promise;
    expect(result.code).toBe(ATTACH_EXIT.FAILURE);
    expect(result.message).toContain('raw mode');
  });

  it('restores it when the connection drops after the session was ready', async () => {
    const { socket, stdin, promise } = setup();
    ready(socket);

    socket.emit('close');

    expect((await promise).code).toBe(ATTACH_EXIT.SESSION);
    expect(stdin.raw).toEqual([true, false]);
  });
});
