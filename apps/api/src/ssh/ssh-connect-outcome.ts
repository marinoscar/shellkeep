// =============================================================================
// How an SSH connect ended, as a bounded metric label (issue #53)
// =============================================================================
//
// `app.terminal.ssh.connect.duration` carries ONE attribute, `outcome`, drawn from
// this closed set (anything else would become `other` in the metrics host):
//
//   ok                 the connection is authenticated and ready
//   auth_failed        the server refused every credential offered
//   timeout            the handshake or authentication outran its deadline
//   host_key_mismatch  the key differs from the one trusted (nothing was sent)
//   host_key_unknown   no key is trusted yet and the policy does not auto-trust
//                      (nothing was sent; an expected prompt, not a failure)
//   refused            the server was not reachable: connection refused or reset,
//                      host or network unreachable, or the name did not resolve
//   error              anything else (protocol, key parsing, a local fault)
//
// Never a hostname, an address, a user, a profile id or the raw error text: this is
// a classification, and the raw message is logged at `warn` by the caller.
// =============================================================================

import { HostKeyError } from './host-key.error';

/** The closed value set of the `outcome` attribute. */
export const SSH_CONNECT_OUTCOMES = [
  'ok',
  'auth_failed',
  'timeout',
  'host_key_mismatch',
  'host_key_unknown',
  'refused',
  'error',
] as const;

export type SshConnectOutcome = (typeof SSH_CONNECT_OUTCOMES)[number];

const REFUSED_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

const TIMEOUT_CODES: ReadonlySet<string> = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);

/** Classifies the error an SSH connect rejected with. Total: any value yields one outcome. */
export function classifySshConnectError(error: unknown): Exclude<SshConnectOutcome, 'ok'> {
  if (error instanceof HostKeyError) {
    return error.code === 'HOST_KEY_MISMATCH' ? 'host_key_mismatch' : 'host_key_unknown';
  }
  if (typeof error !== 'object' || error === null) return 'error';

  const { code, level, message } = error as { code?: unknown; level?: unknown; message?: unknown };
  // ssh2 stamps `level` on the errors it raises itself.
  if (level === 'client-authentication') return 'auth_failed';
  if (level === 'client-timeout') return 'timeout';
  if (typeof code === 'string') {
    if (TIMEOUT_CODES.has(code)) return 'timeout';
    if (REFUSED_CODES.has(code)) return 'refused';
  }
  if (typeof message === 'string') {
    if (/all configured authentication methods failed/i.test(message)) return 'auth_failed';
    if (/timed out/i.test(message)) return 'timeout';
  }
  return 'error';
}
