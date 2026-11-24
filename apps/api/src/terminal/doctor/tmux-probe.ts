// =============================================================================
// The tmux probe's SSH exchange (issue #46, on the factory since #60)
// =============================================================================
//
// One connection, one command, one disconnect, bounded in time. READ-ONLY on the
// remote host too: the only command run is `command -v tmux && tmux -V`.
//
// HOST KEY FIRST. The probe connects through `SshConnectionFactory` (purpose
// `exec`) with the policy forced to `strict`: the presented key must equal the
// profile's pinned fingerprint, a key nobody trusted is refused (never trusted
// automatically: a Doctor check writes nothing), and a refusal happens BEFORE
// authentication, so no credential is sent.
//
// NOTHING BEYOND THE VERSION IS KEPT. The remote's output is reduced to the
// `tmux <version>` token; everything else (the path, stderr, a banner) is
// dropped, and an error message has every secret of the profile redacted.
// =============================================================================

import { HostKeyError } from '../../ssh/host-key.error';
import type { SshConnectionFactory } from '../../ssh/ssh-connection.factory';
import type { DecryptedServerProfile } from '../../ssh/ssh-profile';

/** The one command the probe runs on the remote host. */
export const TMUX_PROBE_COMMAND = 'command -v tmux && tmux -V';

/** The whole exchange (connect, authenticate, run, disconnect) must finish within this by default. */
export const TMUX_PROBE_TIMEOUT_MS = 10_000;

/** The profile the probe connects as: the factory's shape, with the pinned fingerprint required. */
export type TmuxProbeTarget = DecryptedServerProfile & {
  /** The pinned `SHA256:...` fingerprint the presented host key must equal. */
  fingerprint: string;
};

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

/** `tmux 3.4` from the probe's stdout (`/usr/bin/tmux` then `tmux 3.4`), or null. */
export function parseTmuxVersion(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const match = /^tmux\s+(next-)?[0-9][0-9A-Za-z.+_-]{0,31}$/.exec(line.trim());
    if (match) return line.trim();
  }
  return null;
}

/**
 * Connects to the target through the factory and runs {@link TMUX_PROBE_COMMAND}.
 * Never throws; never leaves a socket open (the factory closes it).
 */
export async function probeTmux(
  factory: SshConnectionFactory,
  target: TmuxProbeTarget,
  timeoutMs: number = TMUX_PROBE_TIMEOUT_MS,
): Promise<TmuxProbeResult> {
  try {
    const result = await factory.exec(target, TMUX_PROBE_COMMAND, {
      timeoutMs,
      maxBytes: 4096,
      hostKeyPolicy: 'strict',
    });
    if (result.exitCode !== 0) return { kind: 'tmux-missing' };
    const version = parseTmuxVersion(result.stdout);
    return version ? { kind: 'ok', version } : { kind: 'tmux-missing' };
  } catch (error) {
    if (error instanceof HostKeyError && error.code === 'HOST_KEY_MISMATCH') {
      return { kind: 'host-key-mismatch', presented: error.presented.fingerprint };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'error', message: redact(message, target) };
  }
}
