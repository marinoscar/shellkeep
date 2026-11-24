// =============================================================================
// A server profile's health and host-key state (issue #79)
// =============================================================================
//
// Derived from the stored outcome of the last connection test (`last_test_at`, `last_test_ok`,
// `last_test_code`, written by `POST /server-profiles/:id/test`). One definition for the list's
// columns and filters and for the Home dashboard's counts, so a tile and the list it links to
// always agree.
// =============================================================================

import type { Prisma } from '@prisma/client';
import type { ServerHealth, ServerHostKeyState } from './dto/server-profiles-query.dto';

/** The `where` of each health: `unknown` is never tested, or a test a host-key refusal stopped. */
export const HEALTH_WHERE: Readonly<Record<ServerHealth, Prisma.ServerProfileWhereInput>> = {
  reachable: { lastTestAt: { not: null }, lastTestOk: true },
  unreachable: { lastTestAt: { not: null }, lastTestOk: false },
  unknown: { OR: [{ lastTestAt: null }, { lastTestOk: null }] },
};

/** The health column: the outcome of the last connection test, or `unknown` before the first. */
export function healthOf(profile: { lastTestAt: Date | null; lastTestOk: boolean | null }): ServerHealth {
  if (!profile.lastTestAt || profile.lastTestOk === null) return 'unknown';
  return profile.lastTestOk ? 'reachable' : 'unreachable';
}

/** The host-key column: `mismatch` while the last test was refused for a changed key. */
export function hostKeyStateOf(profile: { fingerprint: string | null; lastTestCode: string | null }): ServerHostKeyState {
  if (!profile.fingerprint) return 'untrusted';
  return profile.lastTestCode === 'HOST_KEY_MISMATCH' ? 'mismatch' : 'trusted';
}

