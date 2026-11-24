// =============================================================================
// The runbook engine wired by hand over a real database and a real shell (issue #62)
// =============================================================================
//
// Builds the engine's services exactly as the module does, over the ordinary-role database of
// `createRlsDatabase` (so row-level security is enforced) and the in-process SSH fixture, with fakes only
// where the platform is outside the engine: storage (a Map), notifications (jest mocks), organization
// credentials (a Map), the event bus (in process) and the access model (the initiator holds `runbooks:run`
// and may use the fixture's profiles). A tiny queue runner claims `runbook.*` jobs from the real `jobs`
// table and calls the real handlers, so enqueue-in-transaction, dedup and settle are the production paths.
// NOT A `*.spec.ts` FILE.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiError } from '@marinoscar/platform-api/ai';
import { createAiRuntimeHarness, type AiRuntimeHarness, type FakeAiScriptedResponse } from '@marinoscar/platform-api/ai/testing';
import { runInOrg, type AuditSink } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, JobScope, JobsService, isJobReason, registerJobReason, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import type { EventBus, EventBusHandler } from '@marinoscar/platform-api/host';

// Registers the AI features (`runbook_agent`, `runbook_draft`) the agent spends under.
import '../../src/app-registrations/ai';
import { registerStorageSliceKeyPrefixes, registerStorageKeyPrefixes, storageKeyPrefixRegistry } from '@marinoscar/platform-api/storage';
import { APP_STORAGE_KEY_PREFIXES } from '../../src/app-registrations/storage-prefixes';
import { RunbookAgentHandler } from '../../src/runbooks/ai/runbook-agent.handler';
import { RunbookAiStopService } from '../../src/runbooks/ai/runbook-ai-stop.service';
import { EngineAccessService, type Initiator } from '../../src/runbooks/engine/engine-access.service';
import { EngineMetricsService } from '../../src/runbooks/engine/engine-metrics.service';
import { LogArchiveService } from '../../src/runbooks/engine/log-archive.service';
import { LogsCompactHandler } from '../../src/runbooks/engine/logs-compact.handler';
import { RunAdvanceHandler } from '../../src/runbooks/engine/run-advance.handler';
import { RunCoordinatorService } from '../../src/runbooks/engine/run-coordinator.service';
import { RunEventsService } from '../../src/runbooks/engine/run-events.service';
import type { RunEvent } from '../../src/runbooks/engine/run-events';
import { RunFileSource, type RunFile } from '../../src/runbooks/engine/run-file-source';
import { RunLifecycleService } from '../../src/runbooks/engine/run-lifecycle.service';
import { RunStartHandler } from '../../src/runbooks/engine/run-start.handler';
import { RunStreamService } from '../../src/runbooks/engine/run-stream.service';
import { RunbookApprovalsService } from '../../src/runbooks/engine/runbook-approvals.service';
import { RunbookRunsService } from '../../src/runbooks/engine/runbook-runs.service';
import { RunbookSettingsService } from '../../src/runbooks/engine/runbook-settings.service';
import { PrismaAuditSink } from '../../src/platform/audit-sink.adapter';
import { SshExecutor } from '../../src/runbooks/engine/ssh-executor';
import { RunbookRiskService } from '../../src/runbooks/safety/runbook-risk.service';
import { TargetRunHandler } from '../../src/runbooks/engine/target-run.handler';
import { DEFAULT_RUNBOOKS_SYSTEM_SETTINGS, type RunbooksSystemSettings } from '../../src/runbooks/settings/runbooks.system-settings';
import { runbookDefinitionSchema, type RunbookDefinitionInput } from '../../src/runbooks/schema/runbook-definition.schema';
import { TargetResolverService } from '../../src/runbooks/target-resolver.service';
import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import { ORG_A, rlsServices, createRlsDatabase, type RlsDatabase } from '../helpers/rls-database.helper';
import { startRunbookSshFixture, type RunbookSshFixture } from './runbook-ssh-fixture';

export { ORG_A };

class InProcessBus implements EventBus {
  readonly adapter = 'in-process';
  readonly origin = 'test';
  private readonly handlers = new Map<string, Set<EventBusHandler<unknown>>>();
  readonly published: Array<{ channel: string; payload: unknown }> = [];
  async publish<T>(channel: string, payload: T): Promise<void> {
    this.published.push({ channel, payload });
    for (const handler of this.handlers.get(channel) ?? []) await handler(payload, { origin: 'test', local: true });
  }
  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler as EventBusHandler<unknown>);
    this.handlers.set(channel, set);
    return () => set.delete(handler as EventBusHandler<unknown>);
  }
  health() {
    return { adapter: this.adapter, connected: true, lastError: null, lastConnectedAt: null, publishFailures: 0, reconnects: 0 };
  }
}

export interface Harness {
  db: RlsDatabase;
  prisma: ReturnType<typeof rlsServices>['prisma'];
  system: ReturnType<typeof rlsServices>['system'];
  fixture: RunbookSshFixture;
  bus: InProcessBus;
  storage: Map<string, Buffer>;
  secrets: Map<string, string>;
  notifications: { notify: jest.Mock; notifyPermissionHolders: jest.Mock };
  runs: RunbookRunsService;
  approvals: RunbookApprovalsService;
  stream: RunStreamService;
  compact: LogsCompactHandler;
  archive: LogArchiveService;
  settings: { current: RunbooksSystemSettings };
  files: { next?: RunFile | Error };
  factsService: { tryProbeClient: jest.Mock };
  audit: { record: jest.Mock };
  finishedEvents: unknown[];
  userA: string;
  userB: string;
  handlers: Map<string, JobHandler>;
  /** The platform's AI runtime over a scripted `FakeAiProvider` (#64); every provider call is in `ai.fake.calls`. */
  ai: AiRuntimeHarness;
  /** The scripted answers the fake provider gives, in order; a function sees the request. */
  script: Array<FakeAiScriptedResponse | ((request: unknown) => FakeAiScriptedResponse | Promise<FakeAiScriptedResponse>)>;
  /** "Stop AI" (#64). */
  aiStop: RunbookAiStopService;
  /** A server profile on the fixture; returns its id. */
  addServer(name: string, over?: { fingerprint?: string | null }): Promise<string>;
  /** A runbook with one version; returns its ids. */
  addRunbook(name: string, definition: RunbookDefinitionInput): Promise<{ runbookId: string; versionId: string }>;
  /** Runs queued `runbook.*` jobs (concurrently within a round) until none is pending, or `until` holds. */
  drain(options?: { until?: () => Promise<boolean>; maxRounds?: number }): Promise<void>;
  /** Everything a run left: run, targets and steps by status. */
  snapshot(runId: string): Promise<{ run: Awaited<ReturnType<typeof readRun>>; steps: Awaited<ReturnType<typeof readSteps>> }>;
  events(): RunEvent[];
  close(): Promise<void>;
}

async function readRun(h: Pick<Harness, 'prisma'>, runId: string) {
  return runInOrg(h.prisma, { orgId: ORG_A }, (tx) =>
    tx.runbookRun.findUniqueOrThrow({ where: { id: runId }, include: { targets: { orderBy: { position: 'asc' } } } }),
  );
}
async function readSteps(h: Pick<Harness, 'prisma'>, runId: string) {
  return runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRunStep.findMany({ where: { runId }, orderBy: [{ runTargetId: 'asc' }, { stepIndex: 'asc' }] }));
}

export async function createHarness(label: string): Promise<Harness> {
  const db = await createRlsDatabase(label);
  const { prisma, system, close: closeServices } = rlsServices(db);
  const fixture = await startRunbookSshFixture();
  const bus = new InProcessBus();
  const storage = new Map<string, Buffer>();
  const secrets = new Map<string, string>();
  const settings = { current: { ...DEFAULT_RUNBOOKS_SYSTEM_SETTINGS } as RunbooksSystemSettings };
  const files: Harness['files'] = {};
  const finishedEvents: unknown[] = [];
  const userA = randomUUID();
  const userB = randomUUID();
  // The key prefixes the app registers at bootstrap (the writer builds its keys with them).
  if (!storageKeyPrefixRegistry.has('runbook-artifacts')) {
    if (!storageKeyPrefixRegistry.has('uploads')) registerStorageSliceKeyPrefixes();
    registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);
  }
  if (!isJobReason('runbook_run')) registerJobReason({ id: 'runbook_run', label: 'Runbook run' });

  await system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.organization.create({ data: { id: ORG_A, name: 'Org Alpha', slug: 'org-alpha' } });
    await tx.user.create({ data: { id: userA, email: 'person-a@example.test', providerDisplayName: 'Person A' } });
    await tx.user.create({ data: { id: userB, email: 'person-b@example.test', providerDisplayName: 'Person B' } });
  });

  // The real audit table, so the audit trail reads what the services wrote; `record` is a spy.
  const auditTable = new PrismaAuditSink(prisma);
  const audit = { record: jest.fn((event: Parameters<AuditSink['record']>[0]) => auditTable.record(event)) } as unknown as AuditSink;
  const notifications = { notify: jest.fn(async () => undefined), notifyPermissionHolders: jest.fn(async () => undefined) };
  const emitter = new EventEmitter2();
  emitter.on('runbooks.run.finished', (event) => finishedEvents.push(event));

  const aiScript: Harness['script'] = [];
  const ai = createAiRuntimeHarness({
    userKey: false,
    fake: {
      responses: async (request) => {
        const next = aiScript.shift();
        if (!next) throw new AiError('AI_PROVIDER_UNAVAILABLE', 'The scripted AI answers are used up');
        return typeof next === 'function' ? next(request) : next;
      },
    },
  });
  ai.addUserKey(userA, ['sk', 'harness', Math.random().toString(36).slice(2, 12)].join('-'), ['fake-model']);
  ai.setDefaultModel(userA, { provider: 'openai', modelId: 'fake-model' });

  const jobs = new JobsService(prisma as never);
  const registry = new JobHandlerRegistry();
  const jobScope = new JobScope(prisma);
  const settingsService = new RunbookSettingsService({ resolveSystem: async () => settings.current } as never);
  const metrics = new EngineMetricsService();
  const events = new RunEventsService(bus);
  const coordinator = new RunCoordinatorService(jobs, settingsService);
  const lifecycle = new RunLifecycleService(events, emitter, notifications as never, prisma, metrics);
  // The sharing decisions are #71's (their own specs): here every caller may read and run every runbook.
  const runbooksFake = {
    requireRun: async () => undefined,
    requireRead: async () => undefined,
    can: async () => true,
    readableWhere: async () => ({}),
  };
  const approvals = new RunbookApprovalsService(prisma, jobs, coordinator, lifecycle, settingsService, metrics, runbooksFake as never, audit);
  const storageProvider = {
    upload: async (key: string, stream: Readable) => {
      const parts: Buffer[] = [];
      for await (const part of stream) parts.push(Buffer.from(part as Buffer));
      storage.set(key, Buffer.concat(parts));
      return { key, bucket: 'test', location: key };
    },
    download: async (key: string) => Readable.from([storage.get(key) ?? Buffer.alloc(0)]),
  };
  const archive = new LogArchiveService(prisma, storageProvider as never);
  const credentials = {
    getSecret: async (_org: string, _purpose: string, name: string) => secrets.get(name) ?? null,
    describe: async (_org: string, _purpose: string, name: string) => (secrets.has(name) ? { name } : null),
  };
  // The resolver's sharing decisions are #71's: here the initiator owns (and may connect to) every profile.
  const allowAll = { decideMany: async (_p: unknown, _action: string, refs: Array<{ type: string; id: string }>) => new Map(refs.map((r) => [`${r.type}:${r.id}`, { allowed: true }])) };
  const resolver = new TargetResolverService(prisma, { resolveSystem: async () => settings.current } as never, allowAll as never, { enrich: async (p: unknown) => p } as never);
  const access = {
    load: async (userId: string, orgId: string): Promise<Initiator> => ({ principal: { userId, permissions: ['runbooks:run', 'ai:use'] } as never, scope: { userId, orgId } }),
    canRun: () => true,
    resolveTargets: (initiator: Initiator, selector: never, limit?: number) => resolver.resolve({ userId: initiator.scope.userId, activeOrgId: initiator.scope.orgId, permissions: [] } as never, selector, limit === undefined ? {} : { limit }),
    decryptProfile: async (_initiator: Initiator, id: string) => {
      const row = await prisma.serverProfile.findFirstOrThrow({ where: { id } });
      return { ...row, authMethod: 'password', password: fixture.password, privateKey: null, passphrase: null };
    },
    requireRun: async () => undefined,
  } as unknown as EngineAccessService;
  const runs = new RunbookRunsService(prisma, jobs, runbooksFake as never, credentials as never, settingsService, coordinator, lifecycle, audit, new RunbookRiskService(), resolver, metrics);
  const factory = new SshConnectionFactory(prisma, audit, { getNamespace: async () => ({ hostKeyPolicy: 'strict' }) } as never);
  const fileSource = { open: async () => { const next = files.next; if (!next) throw new Error('no file'); if (next instanceof Error) throw next; return next; } } as unknown as RunFileSource;

  // The facts probe is #60's own (its specs): here it is a recorder, so a dry run's refresh is observable.
  const factsService = { tryProbeClient: jest.fn(async () => null) };
  const start = new RunStartHandler(registry, prisma, jobScope, coordinator, lifecycle, access, settingsService);
  const target = new TargetRunHandler(registry, prisma, jobScope, coordinator, lifecycle, access, factory, new SshExecutor(), archive, events, settingsService, credentials as never, fileSource, metrics, factsService as never);
  const advance = new RunAdvanceHandler(registry, jobScope, coordinator, lifecycle);
  const compact = new LogsCompactHandler(registry, prisma, system, jobs, coordinator, lifecycle, approvals, archive);
  const agent = new RunbookAgentHandler(
    registry,
    prisma,
    jobScope,
    jobs,
    access,
    factory,
    new SshExecutor(),
    archive,
    events,
    settingsService,
    credentials as never,
    metrics,
    ai.ai,
    ai.aiConfig,
    lifecycle,
    audit,
  );
  const aiStop = new RunbookAiStopService(prisma, runbooksFake as never, jobs, coordinator, events, audit);
  const handlers = new Map<string, JobHandler>([start, target, advance, compact, agent].map((h) => [h.type, h]));

  const harness: Harness = {
    db, prisma, system, fixture, bus, storage, secrets, notifications, runs, approvals, compact, archive, settings, files, finishedEvents, userA, userB, handlers, factsService, ai, script: aiScript, aiStop, audit: audit as never,
    stream: new RunStreamService(prisma, events),
    async addServer(name, over = {}) {
      const row = await prisma.serverProfile.create({
        data: {
          userId: userA,
          orgId: ORG_A,
          name,
          hostname: '127.0.0.1',
          port: fixture.port,
          username: fixture.username,
          authMethod: 'password',
          fingerprint: over.fingerprint === undefined ? fixture.fingerprint : over.fingerprint,
          tags: ['fleet'],
        },
      });
      return row.id;
    },
    async addRunbook(name, definition) {
      const parsed = runbookDefinitionSchema.parse(definition);
      return runInOrg(prisma, { orgId: ORG_A }, async (tx) => {
        const runbook = await tx.runbook.create({ data: { orgId: ORG_A, ownerUserId: userA, name } });
        const version = await tx.runbookVersion.create({
          data: { orgId: ORG_A, runbookId: runbook.id, version: 1, definition: parsed as never, definitionSha256: randomUUID().replace(/-/g, '').padEnd(64, '0') },
        });
        await tx.runbook.update({ where: { id: runbook.id }, data: { latestVersionId: version.id } });
        return { runbookId: runbook.id, versionId: version.id };
      });
    },
    async drain(options = {}) {
      for (let round = 0; round < (options.maxRounds ?? 60); round += 1) {
        if (options.until && (await options.until())) return;
        const pending = await prisma.job.findMany({ where: { status: 'pending', OR: [{ type: { startsWith: 'runbook.' } }, { type: 'ai.runbook.agent' }] }, orderBy: { createdAt: 'asc' } });
        if (pending.length === 0) {
          if (!options.until) return;
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        await Promise.all(
          pending.map(async (job) => {
            await prisma.job.update({ where: { id: job.id }, data: { status: 'running' } });
            try {
              await handlers.get(job.type)!.process(job as Job);
              await prisma.job.update({ where: { id: job.id }, data: { status: 'succeeded' } });
            } catch (error) {
              await prisma.job.update({ where: { id: job.id }, data: { status: 'failed', lastError: error instanceof Error ? error.message : 'error' } });
            }
          }),
        );
      }
    },
    async snapshot(runId) {
      return { run: await readRun({ prisma }, runId), steps: await readSteps({ prisma }, runId) };
    },
    events: () => bus.published.filter((p) => p.channel === 'runbooks.run').map((p) => p.payload as RunEvent),
    async close() {
      await fixture.close();
      await closeServices();
      await db.destroy();
    },
  };
  return harness;
}
