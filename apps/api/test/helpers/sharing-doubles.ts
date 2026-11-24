// =============================================================================
// Test doubles for the sharing slice (issue #71)
// =============================================================================
//
// The integration suites that boot `AppModule` over a MOCKED Prisma client (`createTestApp()`
// with `useMockDatabase: true`) cannot answer `AccessPolicy`'s grant and owner queries, so they
// run with these doubles: every decision is "owner", every group lookup is empty. What the real
// policy decides is proven against a real database in `test/sharing/*.db.spec.ts`. NOT A `*.spec.ts`
// FILE, so Jest never runs it as a suite.
// =============================================================================

export const OWNER_DECISION = { allowed: true, role: 'owner', via: 'owner' } as const;

/** An `AccessPolicy` that allows every action as the owner. */
export const allowAllAccessPolicy = {
  can: async () => true,
  decide: async () => OWNER_DECISION,
  require: async () => OWNER_DECISION,
  requireIn: async () => OWNER_DECISION,
  roleFor: async () => 'owner',
  decideMany: async (_principal: unknown, _action: string, refs: ReadonlyArray<{ type: string; id: string }>) =>
    new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, OWNER_DECISION])),
  decideManyIn: async (_tx: unknown, _principal: unknown, _action: string, refs: ReadonlyArray<{ type: string; id: string }>) =>
    new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, OWNER_DECISION])),
};

/** A `PrincipalGroupsProvider` for a caller who belongs to no group. */
export const noGroups = {
  groupsFor: async () => [],
  enrich: async (principal: object) => ({ ...principal, groups: [] }),
  scopeFor: async (principal: { userId: string; activeOrgId?: string }) => ({
    userId: principal.userId,
    ...(principal.activeOrgId ? { orgId: principal.activeOrgId } : {}),
    groupIds: [],
  }),
  groupRoleFor: async () => null,
  invalidateUsers: () => undefined,
};
