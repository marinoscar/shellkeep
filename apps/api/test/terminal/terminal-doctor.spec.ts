// =============================================================================
// The terminal's Doctor checks (issue #46)
// =============================================================================
//
// Each check is proven with the platform's `describeDoctorCheckConformance`
// (identity, completes without throwing, valid outcome with a remedy on warn and
// fail, no seeded secret in the outcome, READ-ONLY against a recording Prisma
// client) over the scenarios that matter: configured, unconfigured and off.
//
// The tmux probe talks to a scripted `ssh2` server on 127.0.0.1 (no network
// beyond loopback). Beyond the kit, the specs below prove what the kit cannot
// see: the exact remote command, that a host-key refusal happens BEFORE any
// credential is sent, and that an unpinned host is never contacted.
// =============================================================================

import { DoctorCheckRegistry, EgressRegistry, NetworkEgressDoctorCheck } from '@marinoscar/platform-api/doctor';
import {
  createRecordingPrisma,
  describeDoctorCheckConformance,
  runDoctorCheck,
  type DoctorCheckFactory,
} from '@marinoscar/platform-api/doctor/testing';
import type { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { LegacySecretsDoctorCheck } from '../../src/terminal/doctor/legacy-secrets.doctor-check';
import { SessionsReaperDoctorCheck } from '../../src/terminal/doctor/sessions-reaper.doctor-check';
import { SshClientDoctorCheck } from '../../src/terminal/doctor/ssh-client.doctor-check';
import { TerminalSshEgressContributor } from '../../src/terminal/doctor/ssh-egress.contributor';
import { TmuxProbeDoctorCheck } from '../../src/terminal/doctor/tmux-probe.doctor-check';
import { TMUX_PROBE_COMMAND, probeTmux } from '../../src/terminal/doctor/tmux-probe';
import { DEFAULT_TERMINAL_SYSTEM_SETTINGS } from '../../src/terminal/settings/terminal.system-settings';
import { startScriptedSshServer, type ScriptedSshServer } from './scripted-ssh-server';

const PROFILE_ID = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';
const OWNER_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SSH_PASSWORD = 'probe-password-for-tests';

/** The `terminal` system namespace as the Doctor reads it. */
const settingsWith = (overrides: Partial<typeof DEFAULT_TERMINAL_SYSTEM_SETTINGS>): SystemSettingsService =>
  ({
    getNamespace: async () => ({ ...DEFAULT_TERMINAL_SYSTEM_SETTINGS, ...overrides }),
  }) as unknown as SystemSettingsService;

/** A credential store holding the given secrets by credential name. */
const credentialsWith = (secrets: Record<string, string>): UserCredentialsService =>
  ({
    getSecret: async (_userId: string, _purpose: string, name: string) => secrets[name] ?? null,
  }) as unknown as UserCredentialsService;

// -----------------------------------------------------------------------------
// terminal.ssh.client
// -----------------------------------------------------------------------------

describeDoctorCheckConformance('terminal.ssh.client', () => new SshClientDoctorCheck(new DoctorCheckRegistry()), {
  scenarios: [
    { name: 'ssh2 loads', expectStatus: 'pass' },
    {
      name: 'ssh2 is broken',
      build: () => {
        const check = new SshClientDoctorCheck(new DoctorCheckRegistry());
        check.load = () => {
          throw new Error('Cannot find module ssh2');
        };
        return check;
      },
      expectStatus: 'fail',
    },
  ],
});

describe('terminal.ssh.client', () => {
  it('reports the version and the supported host-key algorithms, without a network', async () => {
    const outcome = await new SshClientDoctorCheck(new DoctorCheckRegistry()).run();
    expect(outcome.status).toBe('pass');
    expect(outcome.data?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number(outcome.data?.host_key_algorithms)).toBeGreaterThan(0);
    expect(String(outcome.data?.algorithms)).toContain('ssh-ed25519');
  });

  it('registers itself with the Doctor registry', () => {
    const registry = new DoctorCheckRegistry();
    new SshClientDoctorCheck(registry).onModuleInit();
    expect(registry.list().map((check) => check.id)).toEqual(['terminal.ssh.client']);
  });
});

// -----------------------------------------------------------------------------
// terminal.tmux.probe
// -----------------------------------------------------------------------------

describe('terminal.tmux.probe', () => {
  let server: ScriptedSshServer;

  beforeAll(async () => {
    server = await startScriptedSshServer({ password: SSH_PASSWORD });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.commands.length = 0;
    server.authAttempts.count = 0;
    server.connections.count = 0;
    server.reply = { stdout: '/usr/bin/tmux\ntmux 3.4\n', exitCode: 0 };
  });

  /** The profile row, as the check reads it. */
  const profileRow = (overrides: Record<string, unknown> = {}) => ({
    id: PROFILE_ID,
    userId: OWNER_ID,
    hostname: '127.0.0.1',
    port: server.port,
    username: server.username,
    authMethod: 'password',
    fingerprint: server.fingerprint,
    ...overrides,
  });

  const credentials = () => credentialsWith({ [`profile.${PROFILE_ID}.password`]: SSH_PASSWORD });

  /** The check over the doubles, probing `row` (or nothing when `row` is null). */
  const checkProbing =
    (
      row: () => Record<string, unknown> | null,
      settings: SystemSettingsService = settingsWith({ doctorProbeProfileId: PROFILE_ID }),
    ): DoctorCheckFactory =>
    ({ prisma }) =>
      new TmuxProbeDoctorCheck(new DoctorCheckRegistry(), prisma.client, settings, credentials());

  const rowResult = (row: () => Record<string, unknown> | null) => ({ 'serverProfile.findUnique': () => row() });

  // The conformance kit, over the scenarios of the issue: configured, unconfigured, off.
  describeDoctorCheckConformance(
    'terminal.tmux.probe',
    checkProbing(() => profileRow()),
    {
      scenarios: [
        {
          name: 'configured, key pinned, tmux present',
          prisma: { results: rowResult(() => profileRow()) },
          secrets: [SSH_PASSWORD],
          expectStatus: 'pass',
        },
        {
          name: 'configured, wrong pinned key',
          prisma: { results: rowResult(() => profileRow({ fingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })) },
          secrets: [SSH_PASSWORD],
          expectStatus: 'fail',
        },
        {
          name: 'configured, no pinned key',
          prisma: { results: rowResult(() => profileRow({ fingerprint: null })) },
          expectStatus: 'warn',
        },
        {
          name: 'configured, profile deleted',
          prisma: { results: rowResult(() => null) },
          expectStatus: 'warn',
        },
        {
          name: 'unconfigured (no probe profile)',
          build: checkProbing(() => profileRow(), settingsWith({ doctorProbeProfileId: null })),
          expectStatus: 'skip',
        },
        {
          name: 'configured, tmux missing on the server',
          prisma: { results: rowResult(() => profileRow()) },
          build: (doubles) => {
            server.reply = { stderr: 'sh: tmux: not found\n', exitCode: 1 };
            return checkProbing(() => profileRow())(doubles);
          },
          secrets: [SSH_PASSWORD],
          expectStatus: 'fail',
        },
      ],
    },
  );

  const run = async (row: Record<string, unknown> | null, settings?: SystemSettingsService) => {
    const prisma = createRecordingPrisma({ results: rowResult(() => row) });
    const check = await checkProbing(() => row, settings)({ prisma, storage: undefined as never });
    const result = await runDoctorCheck(check, {});
    return { outcome: result.outcome!, prisma };
  };

  it('passes with the tmux version, running exactly one fixed command', async () => {
    const { outcome, prisma } = await run(profileRow());

    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toContain('tmux 3.4');
    expect(outcome.data).toEqual({ tmux_version: 'tmux 3.4' });
    expect(server.commands).toEqual([TMUX_PROBE_COMMAND]);
    expect(TMUX_PROBE_COMMAND).toBe('command -v tmux && tmux -V');
    // ssh2 first offers `none`, then the password: at least one attempt, never zero.
    expect(server.authAttempts.count).toBeGreaterThan(0);
    // Reads the profile; writes nothing.
    expect(prisma.violations()).toEqual([]);
    expect(prisma.operations().map((op) => op.path)).toEqual(['serverProfile.findUnique']);
  });

  it('refuses a changed host key BEFORE authenticating: no credential is ever sent', async () => {
    const { outcome } = await run(profileRow({ fingerprint: 'SHA256:Zm9yZ2VkLWtleS1mb3ItdGhlLW1pc21hdGNoLXRlc3Q' }));

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('different host key');
    expect(outcome.detail).toContain(server.fingerprint);
    expect(server.authAttempts.count).toBe(0);
    expect(server.commands).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain(SSH_PASSWORD);
  });

  it('warns and never connects when the profile has no pinned host key', async () => {
    const { outcome } = await run(profileRow({ fingerprint: null }));

    expect(outcome.status).toBe('warn');
    expect(outcome.remedy).toBeTruthy();
    expect(server.connections.count).toBe(0);
  });

  it('skips, touching neither the database nor the server, when no probe profile is set', async () => {
    const { outcome, prisma } = await run(profileRow(), settingsWith({ doctorProbeProfileId: null }));

    expect(outcome.status).toBe('skip');
    expect(prisma.operations()).toEqual([]);
    expect(server.connections.count).toBe(0);
  });

  it('fails when tmux is missing on the server', async () => {
    server.reply = { stdout: '', stderr: 'sh: 1: tmux: not found\n', exitCode: 1 };
    const { outcome } = await run(profileRow());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('tmux is not installed');
    // The remote's stderr never reaches the result.
    expect(JSON.stringify(outcome)).not.toContain('not found');
  });

  it('fails, without echoing the secret, when the login is refused', async () => {
    const prisma = createRecordingPrisma({ results: rowResult(() => profileRow()) });
    const check = new TmuxProbeDoctorCheck(
      new DoctorCheckRegistry(),
      prisma.client,
      settingsWith({ doctorProbeProfileId: PROFILE_ID }),
      credentialsWith({ [`profile.${PROFILE_ID}.password`]: 'not-the-password' }),
    );
    const { outcome } = await runDoctorCheck(check, {}).then((r) => ({ outcome: r.outcome! }));

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('could not be reached or refused the login');
    expect(JSON.stringify(outcome)).not.toContain('not-the-password');
    expect(server.commands).toEqual([]);
  });

  it('reduces whatever the remote prints to the tmux version token', async () => {
    server.reply = { stdout: '/usr/bin/tmux\nWelcome to a very chatty host\ntmux next-3.5\n', exitCode: 0 };
    const { outcome } = await run(profileRow());

    expect(outcome.status).toBe('pass');
    expect(outcome.data).toEqual({ tmux_version: 'tmux next-3.5' });
    expect(JSON.stringify(outcome)).not.toContain('chatty');
  });

  it('times out instead of hanging on a host that never answers', async () => {
    const net = await import('node:net');
    const held: import('node:net').Socket[] = [];
    const silent = net.createServer((socket) => {
      held.push(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as import('node:net').AddressInfo).port;

    const started = Date.now();
    const result = await probeTmux(
      {
        hostname: '127.0.0.1',
        port,
        username: 'probe',
        authMethod: 'password',
        password: SSH_PASSWORD,
        fingerprint: server.fingerprint,
      },
      400,
    );
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));

    // ssh2's own handshake timeout or the probe's deadline, whichever fires first.
    expect(result).toMatchObject({ kind: 'error', message: expect.stringMatching(/timed out/i) });
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

// -----------------------------------------------------------------------------
// terminal.sessions.reaper
// -----------------------------------------------------------------------------

describe('terminal.sessions.reaper', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z');
  let lastWhere: any;

  const checkWith =
    (overdue: number, settings: SystemSettingsService = settingsWith({})): DoctorCheckFactory =>
    ({ prisma }) => {
      const check = new SessionsReaperDoctorCheck(new DoctorCheckRegistry(), prisma.client, settings);
      check.now = () => NOW;
      return check;
    };
  const countResult = (overdue: number) => ({
    'terminalSession.count': (args: unknown) => {
      lastWhere = (args as { where: unknown }).where;
      return overdue;
    },
  });

  describeDoctorCheckConformance('terminal.sessions.reaper', checkWith(0), {
    scenarios: [
      { name: 'no overdue session', prisma: { results: countResult(0) }, expectStatus: 'pass' },
      { name: 'overdue sessions', prisma: { results: countResult(3) }, expectStatus: 'warn' },
    ],
  });

  it('counts active sessions idle for more than twice detachAfterMinutes, and only reads', async () => {
    const prisma = createRecordingPrisma({ results: countResult(2) });
    const check = await checkWith(2, settingsWith({ detachAfterMinutes: 30 }))({ prisma, storage: undefined as never });
    const outcome = (await runDoctorCheck(check, {})).outcome!;

    expect(outcome.status).toBe('warn');
    expect(outcome.data).toEqual({ overdue: 2, detach_after_minutes: 30 });
    expect(lastWhere).toEqual({
      status: 'active',
      lastActivityAt: { lt: new Date(NOW.getTime() - 2 * 30 * 60_000) },
    });
    expect(prisma.violations()).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// terminal.ssh.legacy-secrets
// -----------------------------------------------------------------------------

describe('terminal.ssh.legacy-secrets', () => {
  /** Legacy columns that hold a value, by column name, and the credential rows that exist. */
  const world = (legacy: Record<string, Array<{ id: string; userId: string }>>, stored: Array<{ userId: string; name: string }>) => ({
    'serverProfile.findMany': (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      const column = Object.keys(where)[0];
      return legacy[column] ?? [];
    },
    'userCredential.findMany': () => stored,
  });
  const factory: DoctorCheckFactory = ({ prisma }) => new LegacySecretsDoctorCheck(new DoctorCheckRegistry(), prisma.client);

  describeDoctorCheckConformance('terminal.ssh.legacy-secrets', factory, {
    scenarios: [
      { name: 'no legacy secret', prisma: { results: world({}, []) }, expectStatus: 'pass' },
      {
        name: 'a legacy secret not yet migrated',
        prisma: { results: world({ encryptedPassword: [{ id: PROFILE_ID, userId: OWNER_ID }] }, []) },
        expectStatus: 'warn',
      },
      {
        name: 'every legacy secret migrated',
        prisma: {
          results: world({ encryptedPassword: [{ id: PROFILE_ID, userId: OWNER_ID }] }, [
            { userId: OWNER_ID, name: `profile.${PROFILE_ID}.password` },
          ]),
        },
        expectStatus: 'pass',
      },
    ],
  });

  it('counts profiles, not secrets, and never selects a ciphertext column', async () => {
    const OTHER = '8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
    const prisma = createRecordingPrisma({
      results: world(
        {
          encryptedPassword: [{ id: PROFILE_ID, userId: OWNER_ID }, { id: OTHER, userId: OWNER_ID }],
          encryptedPrivateKey: [{ id: PROFILE_ID, userId: OWNER_ID }],
        },
        [{ userId: OWNER_ID, name: `profile.${OTHER}.password` }],
      ),
    });
    const outcome = (await runDoctorCheck(await factory({ prisma, storage: undefined as never }), {})).outcome!;

    // PROFILE has two legacy secrets and no credential rows; OTHER is migrated.
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toEqual({ profiles: 1 });
    expect(prisma.violations()).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// terminal.ssh.egress (an egress contributor, graded by network.egress)
// -----------------------------------------------------------------------------

describe('terminal.ssh.egress', () => {
  const hostsResult = (hostnames: string[]) => ({
    'serverProfile.findMany': () => hostnames.map((hostname) => ({ hostname })),
  });

  const networkCheck =
    (network: 'online' | 'air-gapped'): DoctorCheckFactory =>
    ({ prisma }) => {
      const egress = new EgressRegistry();
      new TerminalSshEgressContributor(egress, prisma.client).onModuleInit();
      return new NetworkEgressDoctorCheck(new DoctorCheckRegistry(), egress, { network });
    };

  // network.egress over the terminal's declaration.
  describeDoctorCheckConformance('network.egress with terminal.ssh', networkCheck('air-gapped'), {
    scenarios: [
      { name: 'air-gapped, a public host', prisma: { results: hostsResult(['server.example.test']) }, expectStatus: 'warn' },
      { name: 'air-gapped, private hosts only', prisma: { results: hostsResult(['10.0.0.5', 'build-box']) }, expectStatus: 'pass' },
      { name: 'air-gapped, no profile', prisma: { results: hostsResult([]) }, expectStatus: 'pass' },
      { name: 'online, a public host', build: networkCheck('online'), prisma: { results: hostsResult(['server.example.test']) }, expectStatus: 'pass' },
    ],
  });

  it('declares hostnames only, capped, never a username or port', async () => {
    const prisma = createRecordingPrisma({ results: hostsResult(['Server.Example.Test', '10.0.0.5']) });
    const contributor = new TerminalSshEgressContributor(new EgressRegistry(), prisma.client);

    const [dependency] = await contributor.describe();

    expect(dependency).toMatchObject({
      id: 'terminal.ssh',
      direction: 'server',
      enabled: true,
      required: false,
      hosts: ['server.example.test', '10.0.0.5'],
      scope: 'public',
      count: 2,
    });
    const call = prisma.operations().find((op) => op.path === 'serverProfile.findMany');
    expect(call).toBeDefined();
    expect(prisma.violations()).toEqual([]);
  });

  it('asks for at most 20 distinct hostnames and selects nothing else', async () => {
    let args: any;
    const prisma = createRecordingPrisma({
      results: { 'serverProfile.findMany': (a: unknown) => ((args = a), []) },
    });
    await new TerminalSshEgressContributor(new EgressRegistry(), prisma.client).describe();

    expect(args).toMatchObject({ distinct: ['hostname'], select: { hostname: true }, take: 20 });
  });

  it('is disabled with no profile and survives an unreadable table', async () => {
    const none = createRecordingPrisma({ results: hostsResult([]) });
    expect((await new TerminalSshEgressContributor(new EgressRegistry(), none.client).describe())[0].enabled).toBe(false);

    const broken = createRecordingPrisma({
      results: {
        'serverProfile.findMany': () => {
          throw new Error('connection refused');
        },
      },
    });
    const [dependency] = await new TerminalSshEgressContributor(new EgressRegistry(), broken.client).describe();
    expect(dependency.enabled).toBe(false);
    expect(dependency.hosts).toEqual([]);
  });
});
