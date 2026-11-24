// =============================================================================
// The host-key trust policy table (issue #60)
// =============================================================================
//
// One pure function: what to do with the key a server presented, given the
// fingerprint the profile trusts, the system policy and why we are connecting.
//
//   | Situation                        | interactive / test / exec    | scan    |
//   | fingerprint equal                | accept                       | capture |
//   | null, tofu_prompt                | refuse HOST_KEY_UNKNOWN      | capture |
//   | null, tofu_auto                  | trust, accept (audited)      | capture |
//   | null, strict                     | refuse HOST_KEY_UNKNOWN      | capture |
//   | differs                          | ALWAYS refuse HOST_KEY_MISMATCH | capture |
//
// A changed key is never accepted by any policy or purpose.
// =============================================================================

import { sameFingerprint } from './host-key';
import type { HostKeyErrorCode } from './host-key.error';

export const HOST_KEY_POLICIES = ['tofu_prompt', 'tofu_auto', 'strict'] as const;
export type HostKeyPolicy = (typeof HOST_KEY_POLICIES)[number];
export const DEFAULT_HOST_KEY_POLICY: HostKeyPolicy = 'tofu_prompt';

export type SshPurpose = 'interactive' | 'test' | 'exec' | 'scan';

/** The `outcome` label of `app.ssh.host_key_checks`. */
export type HostKeyOutcome = 'match' | 'unknown' | 'mismatch' | 'auto_trusted';

export type HostKeyDecision =
  | { action: 'accept'; outcome: 'match' }
  | { action: 'trust'; outcome: 'auto_trusted' }
  | { action: 'refuse'; outcome: 'unknown'; code: Extract<HostKeyErrorCode, 'HOST_KEY_UNKNOWN'> }
  | { action: 'refuse'; outcome: 'mismatch'; code: Extract<HostKeyErrorCode, 'HOST_KEY_MISMATCH'> }
  | { action: 'capture' };

export function decideHostKey(input: {
  trusted: string | null | undefined;
  presented: string;
  policy: HostKeyPolicy;
  purpose: SshPurpose;
}): HostKeyDecision {
  // A scan only looks: it captures the key and refuses, whatever the policy.
  if (input.purpose === 'scan') return { action: 'capture' };

  if (input.trusted) {
    return sameFingerprint(input.trusted, input.presented)
      ? { action: 'accept', outcome: 'match' }
      : { action: 'refuse', outcome: 'mismatch', code: 'HOST_KEY_MISMATCH' };
  }

  if (input.policy === 'tofu_auto') return { action: 'trust', outcome: 'auto_trusted' };
  return { action: 'refuse', outcome: 'unknown', code: 'HOST_KEY_UNKNOWN' };
}
