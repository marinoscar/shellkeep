// =============================================================================
// ShellKeep's onboarding steps and facts (issue #70)
// =============================================================================
//
// Unit tests over the registries the composition root fills: the five steps in
// order with their links, tiers and permissions, each step's `evaluate`, the
// facts' user and organization scoping (each is ONE count over the caller's own
// rows), the `ai` feature gate, skip persistence through the `onboarding`
// namespace's merge, and the activation milestone. The derivation runs through
// the slice's own engine (`evaluateOnboarding`), as `GET /api/onboarding` does.
// =============================================================================
import '../../src/shellkeep.manifest';

import {
  activationMilestoneRegistry,
  assertOnboardingRegistries,
  evaluateOnboarding,
  mergeOnboardingSettings,
  onboardingFactRegistry,
  onboardingStepRegistry,
  type OnboardingRequestContext,
} from '@marinoscar/platform-api/onboarding';

import { SHELLKEEP_ONBOARDING_FACTS as FACTS, SHELLKEEP_ONBOARDING_STEPS as STEPS } from '../../src/onboarding/onboarding.ids';
import { PrismaService } from '../../src/prisma/prisma.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const SHELLKEEP_ORDER = [STEPS.ADD_SERVER, STEPS.TRUST_HOST_KEY, STEPS.OPEN_SESSION, STEPS.ADD_AI_KEY, STEPS.FIRST_RUNBOOK];
const ALL_PERMISSIONS = ['servers:read', 'servers:write', 'sessions:read', 'sessions:write', 'ai:use', 'runbooks:read', 'runbooks:write', 'user_settings:read'];

const step = (id: string) => {
  const def = onboardingStepRegistry.get(id);
  if (!def) throw new Error(`step ${id} is not registered`);
  return def;
};

interface Counts {
  servers: number;
  trusted: number;
  sessions: number;
  aiKeys: number;
  runbooks: number;
}

/** A fake Prisma that answers the five counts and records every `where`. */
function fakePrisma(counts: Counts) {
  const wheres: Record<string, unknown[]> = { serverProfile: [], terminalSession: [], userAiKey: [], runbook: [] };
  const runbook = { count: jest.fn(async ({ where }: { where: unknown }) => (wheres.runbook.push(where), counts.runbooks)) };
  const executed: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => (executed.push(strings.join('?')), 1)),
    $executeRawUnsafe: jest.fn(async (sql: string) => (executed.push(sql), 1)),
    $queryRaw: jest.fn(async () => []),
    runbook,
  };
  const client = {
    serverProfile: {
      count: jest.fn(async ({ where }: { where: { fingerprint?: unknown } }) => {
        wheres.serverProfile.push(where);
        return where.fingerprint ? counts.trusted : counts.servers;
      }),
    },
    terminalSession: { count: jest.fn(async ({ where }: { where: unknown }) => (wheres.terminalSession.push(where), counts.sessions)) },
    userAiKey: { count: jest.fn(async ({ where }: { where: unknown }) => (wheres.userAiKey.push(where), counts.aiKeys)) },
    runbook,
    executed,
    // A root client (not a transaction client) to `runInOrg`.
    $connect: jest.fn(),
    $extends: jest.fn(),
    // `runInOrg`: one interactive transaction whose first statements set the RLS scope.
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, wheres };
}

async function derive(
  counts: Counts,
  options: { ai?: boolean; skipped?: string[]; permissions?: string[]; activeOrgId?: string | null } = {},
) {
  const { client, wheres } = fakePrisma(counts);
  const result = await evaluateOnboarding({
    steps: onboardingStepRegistry.list(),
    facts: onboardingFactRegistry.list(),
    orderings: [],
    includeAdmin: false,
    skipped: options.skipped ?? [],
    context: (doctorCheckIds, fact): OnboardingRequestContext => ({
      caller: {
        id: USER_ID,
        permissions: options.permissions ?? ALL_PERMISSIONS,
        roles: ['contributor'],
        activeOrgId: options.activeOrgId === undefined ? ORG_ID : options.activeOrgId,
      },
      refresh: false,
      data: {
        readUserSettingsValue: async () => null,
        countAllowlistEntriesExcept: async () => 0,
        queryAggregate: async () => [],
      },
      doctor: null,
      doctorCheckIds,
      initialAdminEmail: null,
      isFeatureEnabled: async (feature) => (feature === 'ai' ? (options.ai ?? true) : false),
      fact: fact as OnboardingRequestContext['fact'],
      get: (<T>(token: unknown) => {
        if (token !== PrismaService) throw new Error('unexpected provider');
        return client as unknown as T;
      }) as OnboardingRequestContext['get'],
    }),
  });
  const shellkeep = result.user.steps.filter((s) => s.id.startsWith('shellkeep.'));
  return { result, shellkeep, wheres, client };
}

const ZERO: Counts = { servers: 0, trusted: 0, sessions: 0, aiKeys: 0, runbooks: 0 };

describe('ShellKeep onboarding registrations', () => {
  it('registers the five steps for the user audience, in order, with their links', () => {
    const defs = SHELLKEEP_ORDER.map(step);
    expect(defs.map((d) => d.order)).toEqual([10, 20, 30, 40, 50]);
    expect(defs.every((d) => d.audience === 'user')).toBe(true);
    expect(defs.map((d) => d.href)).toEqual(['/servers?new=1', '/servers', '/sessions?new=1', '/settings/ai', '/runbooks']);
    expect(defs.map((d) => [d.tier, d.skippable])).toEqual([
      ['required', false],
      ['required', false],
      ['required', false],
      ['recommended', true],
      ['recommended', true],
    ]);
    expect(defs.map((d) => d.permission)).toEqual(['servers:write', 'servers:write', 'sessions:write', 'ai:use', 'runbooks:write']);
    expect(step(STEPS.ADD_AI_KEY).feature).toBe('ai');
  });

  it('registers every fact a step names, and the platform steps beside them', () => {
    for (const id of Object.values(FACTS)) expect(onboardingFactRegistry.has(id)).toBe(true);
    expect(onboardingStepRegistry.has('admin.storage')).toBe(true);
    expect(onboardingStepRegistry.has('user.profile')).toBe(true);
    // The check `OnboardingModule` runs at bootstrap: a step naming an unregistered fact fails it.
    expect(() => assertOnboardingRegistries()).not.toThrow();
  });

  it('registers the first-session activation milestone over terminal_sessions', () => {
    const milestone = activationMilestoneRegistry.get('shellkeep_first_session_opened');
    expect(milestone).toBeDefined();
    expect(milestone?.windowDays).toBe(7);
    expect(milestone?.firstReachedAtSql).toContain('terminal_sessions');
    expect(milestone?.firstReachedAtSql).not.toContain(';');
  });
});

describe('ShellKeep onboarding derivation', () => {
  it('lists the five ShellKeep steps in order, all todo, for a fresh user', async () => {
    const { shellkeep } = await derive(ZERO);
    expect(shellkeep.map((s) => s.id)).toEqual(SHELLKEEP_ORDER);
    expect(shellkeep.map((s) => s.status)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
  });

  it('flips the first three to done once a server exists, its key is trusted and a session was opened', async () => {
    const { shellkeep } = await derive({ ...ZERO, servers: 1, trusted: 1, sessions: 1 });
    expect(shellkeep.map((s) => s.status)).toEqual(['done', 'done', 'done', 'todo', 'todo']);
  });

  it('marks the AI key and runbook steps done from their counts', async () => {
    const { shellkeep } = await derive({ servers: 2, trusted: 1, sessions: 4, aiKeys: 1, runbooks: 3 });
    expect(shellkeep.every((s) => s.status === 'done')).toBe(true);
  });

  it('hints at the next action on the host-key step', async () => {
    const none = (await derive(ZERO)).shellkeep.find((s) => s.id === STEPS.TRUST_HOST_KEY);
    expect(none?.detail).toMatch(/Add a server first/);
    const untrusted = (await derive({ ...ZERO, servers: 1 })).shellkeep.find((s) => s.id === STEPS.TRUST_HOST_KEY);
    expect(untrusted?.status).toBe('todo');
    expect(untrusted?.detail).toMatch(/trust the fingerprint/);
  });

  it('omits the AI key step while AI is off', async () => {
    const { shellkeep } = await derive(ZERO, { ai: false });
    expect(shellkeep.map((s) => s.id)).not.toContain(STEPS.ADD_AI_KEY);
    expect(shellkeep).toHaveLength(4);
  });

  it('omits a step whose permission the caller lacks (a viewer cannot add a server or a runbook)', async () => {
    const { shellkeep } = await derive(ZERO, { permissions: ['servers:read', 'sessions:read', 'sessions:write', 'runbooks:read', 'user_settings:read'] });
    expect(shellkeep.map((s) => s.id)).toEqual([STEPS.OPEN_SESSION]);
  });

  it('reports a skipped step as skipped, keeping its derived status', async () => {
    const { shellkeep } = await derive(ZERO, { skipped: [STEPS.ADD_AI_KEY] });
    const ai = shellkeep.find((s) => s.id === STEPS.ADD_AI_KEY);
    expect(ai).toMatchObject({ skipped: true, status: 'todo' });
  });

  it("scopes every fact to the caller and the request's organization", async () => {
    const { wheres, client } = await derive(ZERO);
    expect(wheres.serverProfile).toEqual(
      expect.arrayContaining([
        { userId: USER_ID, orgId: ORG_ID },
        { userId: USER_ID, orgId: ORG_ID, fingerprint: { not: null } },
      ]),
    );
    expect(wheres.terminalSession).toEqual([{ userId: USER_ID, orgId: ORG_ID }]);
    expect(wheres.userAiKey).toEqual([{ userId: USER_ID }]);
    expect(wheres.runbook).toEqual([{ orgId: ORG_ID, ownerUserId: USER_ID, archivedAt: null }]);
    // The runbook count ran inside an RLS transaction.
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.executed[0]).toContain("set_config('app.org_id'");
  });

  it('resolves each fact once per derivation', async () => {
    const { client } = await derive(ZERO);
    expect(client.serverProfile.count).toHaveBeenCalledTimes(2);
    expect(client.terminalSession.count).toHaveBeenCalledTimes(1);
    expect(client.userAiKey.count).toHaveBeenCalledTimes(1);
    expect(client.runbook.count).toHaveBeenCalledTimes(1);
  });

  it('omits the org-scoped steps (never fails) when the credential carries no organization', async () => {
    const { shellkeep } = await derive(ZERO, { activeOrgId: null });
    expect(shellkeep.map((s) => s.id)).toEqual([STEPS.ADD_AI_KEY]);
  });
});

describe('the onboarding user-settings namespace', () => {
  it('stores a skip of a skippable ShellKeep step', () => {
    expect(mergeOnboardingSettings(undefined, { skipped: [STEPS.ADD_AI_KEY, STEPS.FIRST_RUNBOOK] })).toEqual({
      skipped: [STEPS.ADD_AI_KEY, STEPS.FIRST_RUNBOOK],
    });
  });

  it('refuses to skip a required ShellKeep step', () => {
    expect(() => mergeOnboardingSettings(undefined, { skipped: [STEPS.ADD_SERVER] })).toThrow();
  });
});
