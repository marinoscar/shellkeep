// =============================================================================
// An in-process SSH server that runs what the engine sends (issue #62)
// =============================================================================
//
// An `ssh2` Server on 127.0.0.1 (ephemeral port, loopback only), password auth, an ed25519 host key.
// It records exactly what a client does, and EXECUTES the scripts the engine pipes in over stdin with a
// real shell, so exit codes, `sleep`, `set -e` and stdin-reading commands behave as on a server:
//
//   execs      the exec command line of every channel (the argv a process list would show)
//   stdins     the text written to each channel's stdin (prelude, parameters, script)
//   signals    the signals the client sent (`INT` on a timeout or a cancel)
//
// Only `bash -s`, `sh -s`, `python3 -` and the `sudo -n [-u user]` forms are run (sudo itself is not
// invoked: the fixture runs the interpreter directly and records the line). Anything else exits 127.
// NOT A `*.spec.ts` FILE.
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo, Socket } from 'node:net';

import { Server } from 'ssh2';

import { fingerprintOf } from '../../src/ssh/host-key';
import { generateHostKey } from '../terminal/scripted-ssh-server';

export interface RunbookSshFixture {
  readonly port: number;
  readonly fingerprint: string;
  readonly username: string;
  readonly password: string;
  readonly execs: string[];
  readonly stdins: string[];
  readonly signals: string[];
  readonly authAttempts: { count: number };
  /** Children still running (a cancel test waits for this to drop). */
  running(): number;
  close(): Promise<void>;
}

const RUNNABLE = /^(?:sudo -n(?: -u \S+)? )?(bash -s|sh -s|python3 -)$/;

export async function startRunbookSshFixture(options: { username?: string; password?: string } = {}): Promise<RunbookSshFixture> {
  const username = options.username ?? 'runner';
  const password = options.password ?? ['fixture', 'pass', Math.random().toString(36).slice(2)].join('-');
  const { keys, parsed } = generateHostKey();
  const sockets = new Set<Socket>();
  const children = new Set<ChildProcess>();
  const state = {
    execs: [] as string[],
    stdins: [] as string[],
    signals: [] as string[],
    authAttempts: { count: 0 },
  };

  // ssh2's server delivers a `signal` request only before an exec is accepted, so one that arrives
  // while the command runs is read from the protocol debug line (`CHANNEL_REQUEST (r:0, signal: INT)`).
  // It applies to every running child: a spec that sends a signal runs one command at a time.
  const onDebug = (message: string): void => {
    const match = /CHANNEL_REQUEST \(r:\d+, signal: (\w+)\)/.exec(message);
    if (!match) return;
    state.signals.push(match[1]!);
    for (const child of children) {
      if (!child.pid) continue;
      try {
        // A test runner may start this process with SIGINT ignored (inherited by every child): INT is
        // recorded as INT and delivered as TERM, which ends the shell and its `sleep` the same way.
        process.kill(-child.pid, match[1] === 'INT' ? 'SIGTERM' : (`SIG${match[1]}` as NodeJS.Signals));
      } catch {
        // already gone
      }
    }
  };

  const server = new Server({ hostKeys: [keys.private], debug: onDebug }, (client) => {
    client.on('authentication', (ctx) => {
      state.authAttempts.count += 1;
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('error', () => undefined);
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        let child: ChildProcess | undefined;
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          state.execs.push(info.command);
          const match = RUNNABLE.exec(info.command);
          if (!match) {
            stream.stderr.write('command not found\n');
            stream.exit(127);
            stream.end();
            return;
          }
          const [binary, ...args] = match[1]!.split(' ');
          child = spawn(binary!, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
          children.add(child);
          const captured: Buffer[] = [];
          stream.on('data', (data: Buffer) => {
            captured.push(data);
            child!.stdin!.write(data);
          });
          stream.on('end', () => {
            state.stdins.push(Buffer.concat(captured).toString('utf8'));
            child!.stdin!.end();
          });
          child.stdout!.on('data', (d: Buffer) => stream.write(d));
          child.stderr!.on('data', (d: Buffer) => stream.stderr.write(d));
          child.on('error', () => undefined);
          child.on('close', (code, signal) => {
            children.delete(child!);
            if (typeof code === 'number') stream.exit(code);
            else stream.exit(signal ?? 'KILL');
            stream.end();
          });
          stream.on('close', () => {
            if (child && child.exitCode === null && child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                // already gone
              }
            }
          });
        });
      });
    });
  });
  server.on('connection', (raw) => {
    const socket = raw as unknown as Socket;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    fingerprint: fingerprintOf(parsed.getPublicSSH()),
    username,
    password,
    ...state,
    running: () => children.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const child of children) {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
        for (const socket of sockets) {
          const closable = socket as unknown as { destroy?: () => void; end?: () => void };
          (closable.destroy ?? closable.end)?.call(socket);
        }
        server.close(() => resolve());
      }),
  };
}
