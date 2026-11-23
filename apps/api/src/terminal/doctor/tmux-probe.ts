// =============================================================================
// The tmux probe's SSH exchange (issue #46)
// =============================================================================
//
// One connection, one command, one disconnect, bounded in time. READ-ONLY on the
// remote host too: the only command run is `command -v tmux && tmux -V`.
//
// PLATFORM-ADOPTION-SHIM(#60): this is a one-shot connection of its own, because the
// single SSH connection factory of the host-key work does not exist yet; #60 replaces
// it with that factory (see local-exceptions.md).
//
// HOST KEY FIRST. The presented key is compared with the profile's pinned
// fingerprint inside ssh2's `hostVerifier`, which runs BEFORE user
// authentication: on a mismatch the connection is refused and no credential is
// ever sent. There is no path through this file that skips the verifier or
// accepts a changed key.
//
// NOTHING BEYOND THE VERSION IS KEPT. The remote's output is reduced to the
// `tmux <version>` token; everything else (the path, stderr, a banner) is
// dropped, and an error message has every secret of the profile redacted.
// =============================================================================

import { Client, type ConnectConfig } from 'ssh2';

import { fingerprintOf, sameFingerprint } from './host-key-fingerprint';

/** The one command the probe runs on the remote host. */
export const TMUX_PROBE_COMMAND = 'command -v tmux && tmux -V';

/** The whole exchange (connect, authenticate, run, disconnect) must finish within this by default. */
export const TMUX_PROBE_TIMEOUT_MS = 10_000;

export interface TmuxProbeTarget {
  hostname: string;
  port: number;
  username: string;
  authMethod: string;
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  /** The pinned `SHA256:...` fingerprint the presented host key must equal. */
  fingerprint: string;
}

export type TmuxProbeResult =
  | { kind: 'ok'; version: string }
  | { kind: 'tmux-missing' }
  | { kind: 'host-key-mismatch'; presented: string }
  | { kind: 'error'; message: string };

/** Replaces every secret of the target in `text` (a key's body, a password, a passphrase). */
function redact(text: string, target: TmuxProbeTarget): string {
  let out = text;
  for (const secret of [target.password, target.privateKey, target.passphrase]) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out.slice(0, 200);
}

function buildConfig(
  target: TmuxProbeTarget,
  timeoutMs: number,
  hostVerifier: NonNullable<ConnectConfig['hostVerifier']>,
): ConnectConfig {
  const config: ConnectConfig = {
    host: target.hostname,
    port: target.port,
    username: target.username,
    readyTimeout: Math.max(timeoutMs - 2_000, Math.floor(timeoutMs / 2)),
    hostVerifier,
  };
  if (target.authMethod === 'password' && target.password) {
    config.password = target.password;
  } else if (target.authMethod === 'key' && target.privateKey) {
    config.privateKey = target.privateKey;
    if (target.passphrase) config.passphrase = target.passphrase;
  } else if (target.authMethod === 'agent' && process.env.SSH_AUTH_SOCK) {
    config.agent = process.env.SSH_AUTH_SOCK;
  }
  return config;
}

/** `tmux 3.4` from the probe's stdout (`/usr/bin/tmux` then `tmux 3.4`), or null. */
export function parseTmuxVersion(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const match = /^tmux\s+(next-)?[0-9][0-9A-Za-z.+_-]{0,31}$/.exec(line.trim());
    if (match) return line.trim();
  }
  return null;
}

/**
 * Connects to the target, verifies its host key against the pinned fingerprint
 * and runs {@link TMUX_PROBE_COMMAND}. Never throws; never leaves a socket open.
 */
export function probeTmux(
  target: TmuxProbeTarget,
  timeoutMs: number = TMUX_PROBE_TIMEOUT_MS,
): Promise<TmuxProbeResult> {
  return new Promise((resolve) => {
    const client = new Client();
    let settled = false;
    let presented: string | null = null;
    let mismatched = false;

    const finish = (result: TmuxProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        client.end();
        client.destroy();
      } catch {
        // already closed
      }
      resolve(result);
    };

    const deadline = setTimeout(
      () => finish({ kind: 'error', message: `timed out after ${timeoutMs / 1000} s` }),
      timeoutMs,
    );

    client.on('ready', () => {
      client.exec(TMUX_PROBE_COMMAND, (err, stream) => {
        if (err) return finish({ kind: 'error', message: redact(err.message, target) });
        const chunks: Buffer[] = [];
        let received = 0;
        stream.on('data', (chunk: Buffer) => {
          // Bounded: the expected output is two short lines.
          if (received < 4096) {
            chunks.push(chunk);
            received += chunk.length;
          }
        });
        // stderr is drained and discarded, never read.
        stream.stderr.on('data', () => undefined);
        stream.on('close', (code: number | null) => {
          if (code !== 0) return finish({ kind: 'tmux-missing' });
          const version = parseTmuxVersion(Buffer.concat(chunks).toString('utf8'));
          finish(version ? { kind: 'ok', version } : { kind: 'tmux-missing' });
        });
      });
    });

    client.on('error', (err) => {
      if (mismatched && presented) return finish({ kind: 'host-key-mismatch', presented });
      finish({ kind: 'error', message: redact(err.message, target) });
    });
    client.on('close', () => {
      if (mismatched && presented) return finish({ kind: 'host-key-mismatch', presented });
      finish({ kind: 'error', message: 'the connection closed before the probe finished' });
    });

    try {
      client.connect(
        buildConfig(target, timeoutMs, (key: Buffer, verify: (valid: boolean) => void) => {
          presented = fingerprintOf(key);
          const ok = sameFingerprint(presented, target.fingerprint);
          mismatched = !ok;
          verify(ok);
        }),
      );
    } catch (error) {
      finish({ kind: 'error', message: redact(error instanceof Error ? error.message : String(error), target) });
    }
  });
}
