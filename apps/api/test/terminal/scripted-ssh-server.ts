// =============================================================================
// A scripted SSH server for the Doctor specs (issue #46)
// =============================================================================
//
// An in-process `ssh2` Server on 127.0.0.1 (an ephemeral port, no network beyond
// loopback). It presents a freshly generated ed25519 host key, accepts one
// password, answers an `exec` with a scripted reply and records everything the
// client did, so a spec can prove WHAT the probe sent and WHEN:
//
//   authAttempts   how many times the client tried to authenticate. A host-key
//                  refusal must leave this at 0: no credential is ever sent.
//   commands       the exact `exec` command lines.
//   connections    how many TCP connections were accepted.
// =============================================================================

import { Server, utils } from 'ssh2';
import type { AddressInfo } from 'node:net';

import { fingerprintOf } from '../../src/ssh/host-key';

export interface ExecReply {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

export interface ScriptedSshServer {
  readonly port: number;
  /** `SHA256:...` of the key the server presents. */
  readonly fingerprint: string;
  readonly username: string;
  readonly password: string;
  readonly commands: string[];
  readonly authAttempts: { count: number };
  readonly connections: { count: number };
  /** What the next `exec` answers. */
  reply: ExecReply;
  close(): Promise<void>;
}

export async function startScriptedSshServer(
  options: {
    username?: string;
    password?: string;
    reply?: ExecReply;
    /** Listen on this port (to replace a server at the same address with another key). */
    port?: number;
  } = {},
): Promise<ScriptedSshServer> {
  const username = options.username ?? 'probe';
  const password = options.password ?? 'probe-password-for-tests';
  const keys = utils.generateKeyPairSync('ed25519');
  const parsed = utils.parseKey(keys.public);
  if (parsed instanceof Error) throw parsed;
  const fingerprint = fingerprintOf(parsed.getPublicSSH());

  const state: ScriptedSshServer = {
    port: 0,
    fingerprint,
    username,
    password,
    commands: [],
    authAttempts: { count: 0 },
    connections: { count: 0 },
    reply: options.reply ?? { stdout: '/usr/bin/tmux\ntmux 3.4\n', exitCode: 0 },
    close: async () => undefined,
  };

  const sockets = new Set<import('node:net').Socket>();
  const server = new Server({ hostKeys: [keys.private] }, (client) => {
    client.on('authentication', (ctx) => {
      state.authAttempts.count += 1;
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    });
    client.on('error', () => undefined);
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptExec, _reject, info) => {
          state.commands.push(info.command);
          const stream = acceptExec();
          if (state.reply.stdout) stream.write(state.reply.stdout);
          if (state.reply.stderr) stream.stderr.write(state.reply.stderr);
          stream.exit(state.reply.exitCode);
          stream.end();
        });
      });
    });
  });
  server.on('connection', (raw) => {
    // ssh2's typings call the accepted socket a `Connection`; it is the net.Socket.
    const socket = raw as unknown as import('node:net').Socket;
    state.connections.count += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return Object.assign(state, {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // ssh2 emits its own `Connection` (it has `end`, not `destroy`); a raw socket has `destroy`.
        for (const socket of sockets) {
          const closable = socket as unknown as { destroy?: () => void; end?: () => void };
          (closable.destroy ?? closable.end)?.call(socket);
        }
        server.close(() => resolve());
      }),
  });
}
