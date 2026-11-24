/**
 * Host-key verification, web half (issue #60).
 *
 * The SSH layer refuses an unknown or changed host key before any credential is
 * sent and reports it the same way everywhere: a test connection answers
 * `success: false` with `code`, the terminal socket sends a `session_error` with
 * `code`, and the facts and history routes answer 409. These helpers turn each
 * of those into one {@link HostKeyRefusal} the dialog understands.
 */

import { ApiError } from '../../services/api';
import type {
  HostKeyErrorCode,
  HostKeyRefusal,
  PresentedHostKey,
  ServerFacts,
  ServerProfile,
  TestConnectionResult,
} from '../../types/terminal';

export const HOST_KEY_CODES: readonly HostKeyErrorCode[] = ['HOST_KEY_UNKNOWN', 'HOST_KEY_MISMATCH'];

/** `true` for `HOST_KEY_UNKNOWN` and `HOST_KEY_MISMATCH`. */
export function isHostKeyCode(code: unknown): code is HostKeyErrorCode {
  return typeof code === 'string' && (HOST_KEY_CODES as readonly string[]).includes(code);
}

function readPresented(value: unknown): PresentedHostKey | null {
  if (!value || typeof value !== 'object') return null;
  const { fingerprint, algorithm } = value as Record<string, unknown>;
  if (typeof fingerprint !== 'string') return null;
  return { fingerprint, algorithm: typeof algorithm === 'string' ? algorithm : '' };
}

/**
 * A refusal from any message shaped `{ code, presented, expected, serverProfileId? }`
 * (the socket's `session_error`, a 409's `details`), or `null` when it is not one.
 *
 * @param message - the parsed message or details object.
 * @param fallbackProfileId - used when the message names no profile.
 */
export function readHostKeyRefusal(
  message: unknown,
  fallbackProfileId?: string,
  fallbackCode?: HostKeyErrorCode,
): HostKeyRefusal | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const code = isHostKeyCode(m.code) ? m.code : fallbackCode;
  const presented = readPresented(m.presented);
  const serverProfileId =
    typeof m.serverProfileId === 'string' ? m.serverProfileId : fallbackProfileId;
  if (!code || !presented || !serverProfileId) return null;
  const expected = typeof m.expected === 'string' ? m.expected : null;
  return { code, presented, expected, serverProfileId };
}

/** The refusal a test connection reported, or `null` when it was not a host-key refusal. */
export function hostKeyRefusalFromTest(
  result: TestConnectionResult,
  serverProfileId: string,
): HostKeyRefusal | null {
  if (result.success) return null;
  return readHostKeyRefusal(result, serverProfileId);
}

/** The refusal behind a 409 `HOST_KEY_*` API error, or `null`. */
export function hostKeyRefusalFromError(
  error: unknown,
  fallbackProfileId?: string,
): HostKeyRefusal | null {
  if (!(error instanceof ApiError) || !isHostKeyCode(error.code)) return null;
  return readHostKeyRefusal(error.details, fallbackProfileId, error.code);
}

/** Whether a profile trusts a host key. */
export function isHostKeyTrusted(profile: Pick<ServerProfile, 'fingerprint'>): boolean {
  return !!profile.fingerprint;
}

/**
 * The public key file to compare on the server, from the algorithm name
 * (`ssh-ed25519`, `ecdsa-sha2-nistp256`, `ssh-rsa`, `rsa-sha2-512`, ...).
 */
export function hostKeyFileFor(algorithm: string | null | undefined): string {
  const a = (algorithm ?? '').toLowerCase();
  if (a.includes('ecdsa')) return '/etc/ssh/ssh_host_ecdsa_key.pub';
  if (a.includes('rsa')) return '/etc/ssh/ssh_host_rsa_key.pub';
  return '/etc/ssh/ssh_host_ed25519_key.pub';
}

/** The command a user runs on the server to see the fingerprint to compare. */
export function sshKeygenHint(algorithm: string | null | undefined): string {
  return `ssh-keygen -lf ${hostKeyFileFor(algorithm)}`;
}

/** A short label for an algorithm name: `ssh-ed25519` → `ED25519`. */
export function algorithmLabel(algorithm: string | null | undefined): string {
  if (!algorithm) return 'Host key';
  const a = algorithm.toLowerCase();
  if (a.includes('ed25519')) return 'ED25519';
  if (a.includes('ecdsa')) return 'ECDSA';
  if (a.includes('rsa')) return 'RSA';
  return algorithm.toUpperCase();
}

/**
 * The facts worth one line: the OS name, the package manager and whether tmux
 * is installed (ShellKeep's sessions need it).
 */
export function factsSummary(facts: ServerFacts | null | undefined): string[] {
  if (!facts) return [];
  const parts: string[] = [];
  const name =
    facts.prettyName ??
    ([facts.distroId, facts.distroVersion].filter(Boolean).join(' ') || facts.os);
  parts.push(name);
  if (facts.packageManager) parts.push(facts.packageManager);
  parts.push(facts.has.includes('tmux') ? 'tmux installed' : 'no tmux');
  return parts;
}
