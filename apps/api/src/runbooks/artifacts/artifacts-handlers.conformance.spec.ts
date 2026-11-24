// =============================================================================
// The two artifact job handlers pass the platform's handler conformance (issue #63)
// =============================================================================
//
// `runbook.artifacts.bundle` is NODE-ELIGIBLE (it declares `nodeResultSchema` and `persistNodeResult`), so
// `JobHandlerRegistry.serverOnlyTypes()` leaves it out; `runbook.artifacts.purge` deletes by row and key
// through the bypass client and stays server-only. The payload scenarios run twice through a fake queue
// over a database stub in which the run does not exist: the second run must change nothing. The real
// behaviour is covered by `test/runbooks/runbook-artifacts.db.spec.ts`.
// =============================================================================

import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';
import { JobHandlerRegistry, type Job } from '@marinoscar/platform-api/jobs';

import { registerStorageKeyPrefixes, registerStorageSliceKeyPrefixes, storageKeyPrefixRegistry } from '@marinoscar/platform-api/storage';

import { APP_STORAGE_KEY_PREFIXES } from '../../app-registrations/storage-prefixes';
import { ArtifactsPurgeHandler } from './artifacts-purge.handler';
import { BUNDLE_NODE_RESULT, BundleHandler, bundleKey } from './bundle.handler';

// The key prefixes the app registers at bootstrap (the handler builds its keys with them).
if (!storageKeyPrefixRegistry.has('runbook-artifacts')) {
  if (!storageKeyPrefixRegistry.has('uploads')) registerStorageSliceKeyPrefixes();
  registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);
}

const RUN = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b01';
const ORG = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b03';

const empty = { findFirst: async () => null, findMany: async () => [], create: async () => ({}), count: async () => 0, deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) };
const tx = { $executeRaw: async () => 0, runbookRun: empty, runbookArtifact: empty, runbookRunStep: empty };
const stubPrisma: any = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx), $executeRaw: async () => 0, $connect: async () => undefined, $extends: () => undefined };
const none = new Proxy({}, { get: () => async () => undefined }) as never;

const bundleHandler = () => new BundleHandler(new JobHandlerRegistry(), stubPrisma as never, none, none, none);
const purgeHandler = () =>
  new ArtifactsPurgeHandler(
    new JobHandlerRegistry(),
    { runAsSystem: async (_reason: string, fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never,
    { getRetentionPolicy: async () => ({ runbookArtifacts: { enabled: true, days: 30 } }) } as never,
    none,
  );

describeJobHandlerConformance('runbook.artifacts.bundle', bundleHandler, {
  payloads: [{ name: 'a run that does not exist is a no-op', payload: { runId: RUN, orgId: ORG }, subjectType: 'runbook_artifacts', subjectId: RUN, orgId: ORG, reason: 'runbook_run' }],
});

describeJobHandlerConformance('runbook.artifacts.purge', purgeHandler, {
  payloads: [{ name: 'a pass with nothing to purge changes nothing', payload: null, orgId: null, reason: 'runbook_run' }],
});

describe('node eligibility of the artifact jobs', () => {
  it('declares the bundle node-eligible and the purge server-only', () => {
    const registry = new JobHandlerRegistry();
    const bundle = new BundleHandler(registry, stubPrisma as never, none, none, none);
    const purge = new ArtifactsPurgeHandler(registry, none, none, none);
    registry.register(bundle);
    registry.register(purge);
    expect(registry.serverOnlyTypes()).not.toContain('runbook.artifacts.bundle');
    expect(registry.serverOnlyTypes()).toContain('runbook.artifacts.purge');
    expect(bundle).not.toHaveProperty('nodeSecretBroker');
    expect(bundle.profile).toEqual({ maxRuntimeMs: 30 * 60_000, maxAttempts: 3 });
  });

  it('derives the upload key from the job alone and accepts a node result only for that key', async () => {
    const inserted: unknown[] = [];
    const prisma = {
      ...stubPrisma,
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn({ ...tx, runbookArtifact: { ...empty, create: async (args: unknown) => inserted.push(args) } }),
    } as never;
    const handler = new BundleHandler(new JobHandlerRegistry(), prisma, none, none, { bundleBuild: () => undefined, artifactBytes: () => undefined } as never);
    const job = { payload: { runId: RUN, orgId: ORG }, orgId: ORG } as unknown as Job;
    const key = await handler.deriveOutputKey(job);
    expect(key).toBe(bundleKey(ORG, RUN));
    expect(await handler.deriveOutputKey(job)).toBe(key);
    const good = { objectKey: key, sizeBytes: 10, sha256: 'a'.repeat(64), fileCount: 2 };
    expect(BUNDLE_NODE_RESULT.safeParse(good).success).toBe(true);
    expect(BUNDLE_NODE_RESULT.safeParse({ ...good, sha256: 'xyz' }).success).toBe(false);
    await handler.persistNodeResult(job, good);
    expect(inserted).toHaveLength(1);
    await expect(handler.persistNodeResult(job, { ...good, objectKey: `runbook-artifacts/${ORG}/${RUN}/other.zip` })).rejects.toThrow(/key the server named/);
    expect(inserted).toHaveLength(1);
  });
});
