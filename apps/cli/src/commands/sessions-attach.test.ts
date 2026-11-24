import { type AddressInfo } from 'node:net';

import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeProcess, FakeStdin, FakeStdout, programWith } from '../__support__/fakes.js';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';

import { APP_CLI_OPTIONS } from '../app.js';

import { attachSession, runAttachBridge, registerSessionsAttach, type AttachDeps } from './sessions-attach.js';
import { CommandExit } from './exit.js';

// =============================================================================
// `sessions attach` against a fake gateway  (issue #72)
// =============================================================================
//
// A real `ws` server plays /api/terminal/ws with the protocol of
// apps/api/src/terminal/terminal.gateway.ts, and the real bridge talks to it
// over a loopback socket; only the terminal (stdin, stdout, signals) is fake.
// =============================================================================

const SESSION = '5a1e6c0e-6b0e-4d52-9d6e-1f5d0f6f3a11';
const TOKEN = 'pat_fake_gateway_token';

interface Gateway {
  url: string;
  received: Array<{ binary: boolean; data: Buffer }>;
  frames: Array<Record<string, unknown>>;
  socket(): ServerSocket | undefined;
  close(): Promise<void>;
}

/** A gateway that accepts `TOKEN` and `SESSION`, or answers as scripted. */
async function startGateway(options: { rejectToken?: boolean; sessionError?: { error: string; code: string } } = {}): Promise<Gateway> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/api/terminal/ws' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const gateway: Gateway = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received: [],
    frames: [],
    socket: () => [...server.clients][0],
    close: () =>
      new Promise((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
  server.on('connection', (socket) => {
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      gateway.received.push({ binary: isBinary, data });
      if (isBinary) {
        socket.send(Buffer.from(data.toString('utf8').toUpperCase()));
        return;
      }
      const frame = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      gateway.frames.push(frame);
      if (frame.type === 'auth') {
        if (options.rejectToken === true || frame.token !== TOKEN) {
          socket.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid token' }));
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: 'auth_ok' }));
      }
      if (frame.type === 'connect') {
        if (options.sessionError !== undefined) {
          socket.send(JSON.stringify({ type: 'session_error', ...options.sessionError }));
          return;
        }
        socket.send(JSON.stringify({ type: 'session_ready', sessionId: frame.sessionId }));
      }
    });
  });
  return gateway;
}

function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (condition()) resolve();
      else if (Date.now() - started > timeoutMs) reject(new Error('timed out waiting for the condition'));
      else setTimeout(tick, 5);
    };
    tick();
  });
}

let gateway: Gateway;
let stdin: FakeStdin;
let stdout: FakeStdout;
let events: FakeProcess;
let stderr: string;
let restoreIdentity: () => void;

function deps(overrides: Partial<AttachDeps> = {}): AttachDeps {
  return {
    stdin,
    stdout,
    processEvents: events,
    stderr: { write: (text) => ((stderr += text), true) },
    credentials: () => ({ serverUrl: gateway.url, token: TOKEN }),
    ...overrides,
  };
}

beforeEach(() => {
  resetCliForTests();
  restoreIdentity = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
  stdin = new FakeStdin();
  stdout = new FakeStdout();
  events = new FakeProcess();
  stderr = '';
});

afterEach(async () => {
  restoreIdentity();
  await gateway?.close();
});

describe('sessions attach through a fake gateway', () => {
  it('authenticates, connects, relays raw bytes both ways, resizes, and detaches on Ctrl-] d', async () => {
    gateway = await startGateway();
    const attached = attachSession(SESSION, deps());

    await until(() => stdin.raw.includes(true));
    // Handshake order and content.
    expect(gateway.frames.slice(0, 2)).toEqual([
      { type: 'auth', token: TOKEN },
      { type: 'connect', sessionId: SESSION },
    ]);
    // The initial size.
    await until(() => gateway.frames.some((frame) => frame.type === 'resize'));
    expect(gateway.frames.find((frame) => frame.type === 'resize')).toEqual({ type: 'resize', cols: 100, rows: 30 });

    // Bytes out: a binary frame; bytes in: the gateway's reply on stdout.
    stdin.type('ls\r');
    await until(() => stdout.text().includes('LS\r'));
    expect(gateway.received.filter((entry) => entry.binary).map((entry) => entry.data.toString())).toEqual(['ls\r']);

    // A SIGWINCH resizes the remote pane.
    stdout.columns = 120;
    stdout.rows = 40;
    events.emit('SIGWINCH');
    await until(() => gateway.frames.filter((frame) => frame.type === 'resize').length === 2);
    expect(gateway.frames.filter((frame) => frame.type === 'resize').at(-1)).toEqual({ type: 'resize', cols: 120, rows: 40 });

    // Ctrl-] d: detach, exit 0, TTY restored, the escape never reached the gateway.
    stdin.type('\x1dd');
    await expect(attached).resolves.toEqual({ code: 0 });
    expect(stdin.raw).toEqual([true, false]);
    expect(gateway.received.filter((entry) => entry.binary).map((entry) => entry.data.toString())).toEqual(['ls\r']);
  });

  it('exits 3 on auth_fail without entering raw mode', async () => {
    gateway = await startGateway({ rejectToken: true });

    const result = await attachSession(SESSION, deps());

    expect(result.code).toBe(3);
    expect(stdin.raw).toEqual([]);
  });

  it('exits 4 on session_error', async () => {
    gateway = await startGateway({ sessionError: { error: 'Session not found', code: 'NOT_FOUND' } });

    const result = await attachSession(SESSION, deps());

    expect(result.code).toBe(4);
    expect(result.message).toContain('Session not found');
  });

  it('exits 4 when the gateway is unreachable', async () => {
    gateway = await startGateway();
    const url = gateway.url;
    await gateway.close();

    const result = await attachSession(SESSION, deps({ credentials: () => ({ serverUrl: url, token: TOKEN }) }));

    expect(result.code).toBe(4);
  });

  it('exits 2 when stdin is not a TTY, before reading the login or opening a connection', async () => {
    gateway = await startGateway();
    stdin.isTTY = undefined;
    let readCredentials = false;

    const result = await attachSession(
      SESSION,
      deps({
        credentials: () => {
          readCredentials = true;
          return { serverUrl: gateway.url, token: TOKEN };
        },
      }),
    );

    expect(result.code).toBe(2);
    expect(result.message).toContain('TTY');
    expect(readCredentials).toBe(false);
    expect(gateway.frames).toEqual([]);
  });

  it('keeps the token out of the debug log and stderr, logging only sizes and types', async () => {
    gateway = await startGateway();
    const previous = process.env.SHELLKEEP_DEBUG;
    process.env.SHELLKEEP_DEBUG = '1';
    try {
      const attached = attachSession(SESSION, deps());
      await until(() => stdin.raw.includes(true));
      stdin.type('whoami\r');
      await until(() => stdout.text().includes('WHOAMI'));
      stdin.type('\x1dd');
      await attached;
    } finally {
      if (previous === undefined) delete process.env.SHELLKEEP_DEBUG;
      else process.env.SHELLKEEP_DEBUG = previous;
    }

    expect(stderr).toContain('[attach] -> auth');
    expect(stderr).toContain('[attach] -> binary 7 bytes');
    expect(stderr).not.toContain(TOKEN);
    expect(stderr).not.toContain('whoami');
    expect(stderr).not.toContain('WHOAMI');
  });
});

describe('the command and the TUI hand-off', () => {
  it('runAttachBridge returns the exit code and writes one line to stderr on failure', async () => {
    gateway = await startGateway({ rejectToken: true });

    const code = await runAttachBridge({ sessionId: SESSION, deps: deps() });

    expect(code).toBe(3);
    expect(stderr).toContain('authentication failed');
    expect(stderr).not.toContain(TOKEN);
  });

  it('the command throws a CommandExit carrying the bridge code', async () => {
    gateway = await startGateway({ sessionError: { error: 'Session is terminated', code: 'TERMINATED' } });
    const program = programWith((root) => registerSessionsAttach(root.command('sessions'), deps()));

    await expect(program.parseAsync(['sessions', 'attach', SESSION], { from: 'user' })).rejects.toMatchObject({
      constructor: CommandExit,
      exitCode: 4,
    });
  });

  it('the command puts the token in no argument it parses', async () => {
    gateway = await startGateway();
    const program = programWith((root) => registerSessionsAttach(root.command('sessions'), deps()));
    const sessions = program.commands.find((command) => command.name() === 'sessions');
    const attach = sessions?.commands.find((command) => command.name() === 'attach');

    expect(attach?.options.map((option) => option.long)).toEqual([]);
    expect(attach?.registeredArguments.map((argument) => argument.name())).toEqual(['id']);
  });
});
