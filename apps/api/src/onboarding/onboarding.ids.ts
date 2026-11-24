// =============================================================================
// ShellKeep's onboarding ids, spelled once (issue #70)
// =============================================================================
//
// STEP IDS ARE PERMANENT: a user's `onboarding.skipped` list stores them (the
// `onboarding` user-settings namespace), so a rename strands every stored skip.
// Fact ids are not persisted, but a step's `facts` array names them, so a
// rename is a two-file change `assertOnboardingRegistries` checks at boot.
//
// Pure data: no Nest, no Prisma. The facts and steps themselves live beside
// their domain (`server-profiles/`, `terminal/`, `runbooks/`) and are listed in
// `app-registrations/onboarding.ts`.
// =============================================================================

/** The fact ids. Each resolves to a `number`: a read-only count, never row content. */
export const SHELLKEEP_ONBOARDING_FACTS = {
  /** Server profiles the caller owns in the active organization. */
  SERVER_PROFILE_COUNT: 'shellkeep.serverProfileCount',
  /** Of those, the profiles whose host key the caller trusted (a stored `fingerprint`, #60). */
  TRUSTED_HOST_KEY_COUNT: 'shellkeep.trustedHostKeyCount',
  /** Terminal sessions the caller ever created in the active organization (any status). */
  SESSION_COUNT: 'shellkeep.sessionCount',
  /** The caller's own AI provider keys (`user_ai_keys`; the platform has no such fact). */
  AI_KEY_COUNT: 'shellkeep.aiKeyCount',
  /** Runbooks the caller authored in the active organization, not archived. */
  RUNBOOK_COUNT: 'shellkeep.runbookCount',
} as const;

/** The step ids, in checklist order. PERMANENT. */
export const SHELLKEEP_ONBOARDING_STEPS = {
  ADD_SERVER: 'shellkeep.add-server',
  TRUST_HOST_KEY: 'shellkeep.trust-host-key',
  OPEN_SESSION: 'shellkeep.open-session',
  ADD_AI_KEY: 'shellkeep.add-ai-key',
  FIRST_RUNBOOK: 'shellkeep.first-runbook',
} as const;

/**
 * The activation milestone's id. The platform's milestone ids are `[a-z][a-z0-9_]*`
 * (no dot, no hyphen), so the spec's `shellkeep.first-session-opened` is spelled
 * with underscores.
 */
export const SHELLKEEP_FIRST_SESSION_MILESTONE = 'shellkeep_first_session_opened';

/** The facts' org scope, or a rejection (a rejected fact omits its steps; it never fails the response). */
export function requireActiveOrg(activeOrgId: string | null): string {
  if (!activeOrgId) throw new Error('the credential carries no active organization');
  return activeOrgId;
}

/** `done` when the count is positive, else `todo` with an optional hint. */
export function countDone(count: unknown, detail?: string): { status: 'done' | 'todo'; detail?: string } {
  if (typeof count === 'number' && count > 0) return { status: 'done' };
  return detail === undefined ? { status: 'todo' } : { status: 'todo', detail };
}
