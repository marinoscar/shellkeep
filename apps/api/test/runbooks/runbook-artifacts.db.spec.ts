// =============================================================================
// Collected logs, the run bundle and the retention purge, end to end (issue #63)
// =============================================================================
//
// Real Postgres under an ORDINARY role (forced row-level security), the in-process SSH server that runs
// what the engine pipes in with a REAL shell, and the real handlers. Only the platform's edges are fakes
// (storage is a Map). The files are real files in a temporary directory the shell reads. Run with
// `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import JSZip from 'jszip';
import * as tar from 'tar-stream';
import { runInOrg } from '@marinoscar/platform-api/core';
import type { Job } from '@marinoscar/platform-api/jobs';

import { ArtifactsPurgeHandler } from '../../src/runbooks/artifacts/artifacts-purge.handler';
import { BundleHandler } from '../../src/runbooks/artifacts/bundle.handler';
import { RunbookArtifactsService } from '../../src/runbooks/artifacts/runbook-artifacts.service';
import { COLLECT_LOGS_SCRIPT } from '../../src/runbooks/engine/steps/collect-logs.step';
import { EngineMetricsService } from '../../src/runbooks/engine/engine-metrics.service';
import { resolveDbSuite } from '../helpers/db-test-support';
import { createHarness, ORG_A, type Harness } from './engine-harness';

const { describeWithDb } = resolveDbSuite('runbook-artifacts.db.spec');

const MIB = 1024 * 1024;
/** Assembled at run time: no secret-shaped literal sits in the source. */
const SENTINEL = ['sentinel', 'token', Math.random().toString(36).slice(2, 12)].join('-');

const collect = (over: Record<string, unknown>) => ({ id: 'logs', name: 'Collect logs', kind: 'collect_logs', ...over });
const who = (h: Harness, userId = h.userA) => ({ userId, activeOrgId: ORG_A, permissions: ['runbooks:read', 'runbooks:run'] }) as never;

/** Every regular file of a tar.gz, by name. */
async function untar(gz: Buffer): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const extract = tar.extract();
  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const parts: Buffer[] = [];
      stream.on('data', (part: Buffer) => parts.push(part));
      stream.on('end', () => {
        if (header.type === 'file') out.set(header.name, Buffer.concat(parts));
        next();
      });
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });
  Readable.from([gunzipSync(gz)]).pipe(extract);
  await done;
  return out;
}

describeWithDb('Runbook artifacts (real Postgres, real shell)', () => {
  let h: Harness;
  let server: string;
  let dir: string;
  let artifacts: RunbookArtifactsService;
  let bundle: BundleHandler;
  let purge: ArtifactsPurgeHandler;
  const retention = { runbookArtifacts: { enabled: true, days: 30 } };
  const deleted: string[] = [];

  beforeAll(async () => {
    h = await createHarness('artifacts');
    server = await h.addServer('server-one');
    dir = mkdtempSync(join(tmpdir(), 'sk-artifacts-'));
    const storage = {
      upload: async (key: string, stream: Readable) => {
        const parts: Buffer[] = [];
        for await (const part of stream) parts.push(Buffer.from(part as Buffer));
        h.storage.set(key, Buffer.concat(parts));
        return { key };
      },
      download: async (key: string) => Readable.from([h.storage.get(key) ?? Buffer.alloc(0)]),
      delete: async (key: string) => {
        deleted.push(key);
        h.storage.delete(key);
      },
      getSignedDownloadUrl: async (key: string) => `https://storage.example.test/${key}`,
    };
    bundle = new BundleHandler(h.registry, h.prisma, storage as never, h.archive, new EngineMetricsService());
    purge = new ArtifactsPurgeHandler(h.registry, h.system, { getRetentionPolicy: async () => retention } as never, storage as never);
    h.handlers.set(bundle.type, bundle);
    artifacts = new RunbookArtifactsService(h.prisma, { requireVisible: async () => undefined } as never, h.jobs, storage as never, h.audit as never);
  }, 180_000);

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await h?.close();
  });

  async function run(steps: unknown[], extra: Record<string, unknown> = {}, params: Record<string, unknown> = {}): Promise<string> {
    const { runbookId } = await h.addRunbook(`rb-${Math.random().toString(36).slice(2, 8)}`, { schemaVersion: 1, ...extra, steps } as never);
    const { runId } = await h.runs.create(who(h), runbookId, { params, secretRefs: {}, targets: { serverIds: [server] } } as never);
    await h.drain();
    return runId;
  }

  const rows = (runId: string) => runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookArtifact.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }));
  const stepsOf = (runId: string) => runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRunStep.findMany({ where: { runId }, orderBy: { stepIndex: 'asc' } }));

  it('keeps the LAST maxBytesPerFile of a large file and the whole of a small one', async () => {
    const a = join(dir, 'a.log');
    const b = join(dir, 'b.log');
    const big = Buffer.alloc(20 * MIB);
    for (let offset = 0; offset < big.length; offset += 32) big.write(`line-${String(offset / 32).padStart(8, '0')} ok\n`.padEnd(32, '.'), offset, 'ascii');
    big[big.length - 1] = 0x0a;
    writeFileSync(a, big);
    writeFileSync(b, 'small file\n');

    const runId = await run([collect({ paths: [a, b], maxBytesPerFile: MIB })]);
    const [step] = await stepsOf(runId);
    expect(step!.status).toBe('succeeded');
    const [archive] = await rows(runId);
    expect(archive).toMatchObject({ kind: 'target_archive', fileCount: 2, runStepId: step!.id });
    expect(archive!.storageKey).toMatch(new RegExp(`^runbook-artifacts/${ORG_A}/${runId}/[0-9a-f-]+/0\\.tar\\.gz$`));

    const stored = h.storage.get(archive!.storageKey)!;
    expect(createHash('sha256').update(stored).digest('hex')).toBe(archive!.sha256);
    expect(Number(archive!.sizeBytes)).toBe(stored.length);
    const files = await untar(stored);
    const entry = (name: string) => [...files.entries()].find(([key]) => key.endsWith(name))![1];
    expect(entry('a.log').length).toBe(MIB);
    expect(Buffer.compare(entry('a.log'), big.subarray(big.length - MIB))).toBe(0);
    expect(entry('b.log').toString()).toBe('small file\n');
  }, 120_000);

  it('succeeds with file_count 0 when nothing matches, and fails with failIfEmpty', async () => {
    const none = join(dir, 'nothing-*.log');
    const runId = await run([collect({ paths: [none] })]);
    const [step] = await stepsOf(runId);
    expect(step).toMatchObject({ status: 'succeeded', exitCode: 0 });
    const [archive] = await rows(runId);
    expect(archive).toMatchObject({ fileCount: 0 });
    expect(await h.archive.readStepLog(ORG_A, step!.id)).toContain('no files matched');

    const failedRun = await run([collect({ paths: [none], failIfEmpty: true })]);
    const [failed] = await stepsOf(failedRun);
    expect(failed!.status).toBe('failed');
    expect(await rows(failedRun)).toHaveLength(0);
  }, 60_000);

  it('fails ARTIFACT_TOO_LARGE past maxTotalBytes and stores nothing', async () => {
    writeFileSync(join(dir, 'random.bin'), randomBytes(256 * 1024));
    const before = new Set(h.storage.keys());
    const runId = await run([collect({ paths: [join(dir, 'random.bin')], maxBytesPerFile: 256 * 1024, maxTotalBytes: 4096 })]);
    const [step] = await stepsOf(runId);
    expect(step).toMatchObject({ status: 'failed', errorCode: 'ARTIFACT_TOO_LARGE' });
    expect(await rows(runId)).toHaveLength(0);
    const added = [...h.storage.keys()].filter((key) => !before.has(key) && key.includes(runId));
    expect(added.every((key) => key.endsWith('.log'))).toBe(true); // the step log only
  }, 60_000);

  it('treats hostile paths literally: nothing is executed, the script text never carries them', async () => {
    const marker1 = join(dir, 'PWNED1');
    const marker2 = join(dir, 'PWNED2');
    const stdinsBefore = h.fixture.stdins.length;
    const hostile = [`${dir}/$(touch ${marker1})`, `${dir}/x;touch ${marker2}`, `${dir}/\`touch ${marker1}\``];
    const runId = await run([collect({ paths: hostile })]);
    const [step] = await stepsOf(runId);
    expect(step!.status).toBe('succeeded');
    expect(existsSync(marker1)).toBe(false);
    expect(existsSync(marker2)).toBe(false);
    const stdin = h.fixture.stdins.slice(stdinsBefore).find((text) => text.includes('SK_PATHS'))!;
    const body = /<<'(SK_EOF_\w+)'\n([\s\S]*)\n\1\n\)"/.exec(stdin)!;
    expect(body[2]).toBe(COLLECT_LOGS_SCRIPT);
    expect(body[2]).not.toContain('touch');
    // a line break in a path never reaches a shell: the definition is refused
    await expect(h.addRunbook('bad-path', { schemaVersion: 1, steps: [collect({ paths: ['/var/log/a\n/etc/shadow'] })] } as never)).rejects.toThrow();
  }, 60_000);

  it('keeps a space in a path a space, and redacts the run secret from the stored files', async () => {
    h.secrets.set('deploy-token', SENTINEL);
    writeFileSync(join(dir, 'with space.log'), `connect with ${SENTINEL} done\n`);
    const { runbookId } = await h.addRunbook('secret-logs', {
      schemaVersion: 1,
      parameters: [{ name: 'TOKEN', type: 'secret', required: true }],
      steps: [collect({ paths: [join(dir, 'with space.log')] })],
    } as never);
    const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: { TOKEN: 'deploy-token' }, targets: { serverIds: [server] } } as never);
    await h.drain();
    const [archive] = await rows(runId);
    expect(archive!.fileCount).toBe(1);
    const files = await untar(h.storage.get(archive!.storageKey)!);
    const [[name, content]] = [...files.entries()];
    expect(name).toContain('with space.log');
    expect(content.toString()).toContain('connect with ');
    expect(content.toString()).not.toContain(SENTINEL);
    expect(content.toString()).toContain('[REDACTED');
  }, 60_000);

  it('bundles the run into a zip whose manifest.json matches every entry, with no secret in it', async () => {
    writeFileSync(join(dir, 'c.log'), `first\nsecret ${SENTINEL}\n`);
    h.secrets.set('deploy-token', SENTINEL);
    const { runbookId } = await h.addRunbook('bundled', {
      schemaVersion: 1,
      parameters: [{ name: 'TOKEN', type: 'secret', required: true }],
      steps: [{ id: 'hello', name: 'Hello', kind: 'command', command: 'echo "hello $TOKEN"' }, collect({ paths: [join(dir, 'c.log')] })],
    } as never);
    const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: { TOKEN: 'deploy-token' }, targets: { serverIds: [server] } } as never);
    await h.drain();
    expect(h.finishedEvents.length).toBeGreaterThan(0);

    // The post-commit hook: a run with an archive queues the bundle; a second ask collapses onto it.
    await artifacts.bundleIfCollected(ORG_A, runId);
    await artifacts.bundleIfCollected(ORG_A, runId);
    const queued = await h.prisma.job.findMany({ where: { type: 'runbook.artifacts.bundle', subjectId: runId } });
    expect(queued).toHaveLength(1);
    await h.drain();

    const [archive, zipRow] = [...(await rows(runId))].sort((x, y) => x.kind.localeCompare(y.kind) * -1);
    expect(archive!.kind).toBe('target_archive');
    expect(zipRow).toMatchObject({ kind: 'bundle', runTargetId: null, runStepId: null });
    expect(zipRow!.storageKey).toBe(`runbook-artifacts/${ORG_A}/${runId}/bundle.zip`);
    const zipBytes = h.storage.get(zipRow!.storageKey)!;
    expect(createHash('sha256').update(zipBytes).digest('hex')).toBe(zipRow!.sha256);

    const zip = await JSZip.loadAsync(zipBytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      run: { id: string; runbook: string; status: string };
      targets: Array<{ id: string; server: { name: string }; steps: Array<{ id: string; index: number }> }>;
      files: Array<{ path: string; sha256: string; bytes: number }>;
    };
    expect(manifest.run).toMatchObject({ id: runId, runbook: 'bundled', status: 'succeeded' });
    expect(manifest.targets[0]!.server.name).toBe('server-one');
    expect(manifest.targets[0]!.steps.map((s) => s.id)).toEqual(['hello', 'logs']);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir);
    expect(names).toContain('manifest.json');
    expect(manifest.files.map((f) => f.path).sort()).toEqual(names.filter((n) => n !== 'manifest.json').sort());
    expect(manifest.files.some((f) => f.path.endsWith('/logs.tar.gz'))).toBe(true);
    expect(manifest.files.some((f) => /^logs\/server-one__[0-9a-f-]+\/0\.log$/.test(f.path))).toBe(true);

    let everything = '';
    for (const file of manifest.files) {
      const bytes = await zip.file(file.path)!.async('nodebuffer');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(bytes.length).toBe(file.bytes);
      if (file.path.endsWith('.tar.gz')) {
        expect(file.sha256).toBe(archive!.sha256);
        for (const content of (await untar(bytes)).values()) everything += content.toString();
      } else everything += bytes.toString();
    }
    expect(everything).toContain('hello');
    expect(everything).not.toContain(SENTINEL);
    expect(zipBytes.includes(Buffer.from(SENTINEL))).toBe(false);

    // The listing and the job are idempotent: a second pass changes nothing, an ask answers the existing bundle.
    await bundle.process({ payload: { runId, orgId: ORG_A }, orgId: ORG_A } as unknown as Job);
    expect((await rows(runId)).filter((r) => r.kind === 'bundle')).toHaveLength(1);
    const principal = who(h);
    expect(await artifacts.requestBundle(principal, runId)).toEqual({ jobId: null, artifactId: zipRow!.id });
    const listing = await artifacts.list(principal, runId);
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]).toMatchObject({ kind: 'target_archive', serverName: 'server-one', stepId: 'logs', stepIndex: 1 });
    expect(listing.bundle).toMatchObject({ status: 'ready', artifactId: zipRow!.id });
    const signed = await artifacts.download(principal, runId, zipRow!.id);
    expect(signed.url).toContain(zipRow!.storageKey);
    expect(new Date(signed.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const audit = await h.prisma.auditEvent.findMany({ where: { action: 'runbook_artifact.downloaded', targetId: zipRow!.id } });
    expect(audit).toHaveLength(1);
  }, 120_000);

  it('never collects in a dry run', async () => {
    writeFileSync(join(dir, 'dry.log'), 'x\n');
    const { runbookId } = await h.addRunbook('dry-collect', { schemaVersion: 1, steps: [collect({ paths: [join(dir, 'dry.log')] })] } as never);
    const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: {}, targets: { serverIds: [server] }, dryRun: true } as never);
    await h.drain();
    expect(await rows(runId)).toHaveLength(0);
    expect(h.finishedEvents.filter((event) => (event as { runId: string }).runId === runId)).toHaveLength(0);
  }, 60_000);

  describe('retention', () => {
    const job = { payload: null, orgId: null, id: 'job-1' } as unknown as Job;
    let oldRun: string;
    let freshRun: string;

    beforeAll(async () => {
      writeFileSync(join(dir, 'r.log'), 'retention\n');
      oldRun = await run([{ id: 'say', name: 'Say', kind: 'command', command: 'echo old' }, collect({ paths: [join(dir, 'r.log')] })]);
      freshRun = await run([{ id: 'say', name: 'Say', kind: 'command', command: 'echo fresh' }, collect({ paths: [join(dir, 'r.log')] })]);
      await artifacts.bundleIfCollected(ORG_A, oldRun);
      await artifacts.bundleIfCollected(ORG_A, freshRun);
      await h.drain();
      const old = new Date(Date.now() - 60 * 86_400_000);
      await h.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.runbookRun.update({ where: { id: oldRun }, data: { finishedAt: old } });
      });
    }, 120_000);

    const keysOf = async (runId: string) => [
      ...(await rows(runId)).map((r) => r.storageKey),
      ...(await stepsOf(runId)).map((s) => s.logStorageKey).filter((key): key is string => key !== null),
    ];

    it('purges nothing while the policy is off', async () => {
      retention.runbookArtifacts = { enabled: false, days: 30 };
      const before = await keysOf(oldRun);
      expect(before.length).toBeGreaterThanOrEqual(4); // archive, bundle and two step logs
      await purge.process(job);
      expect(await keysOf(oldRun)).toEqual(before);
      expect(deleted).toEqual([]);
    });

    it('purges only runs past the window, leaves the run rows and the fresh run alone', async () => {
      retention.runbookArtifacts = { enabled: true, days: 30 };
      const freshKeys = await keysOf(freshRun);
      const oldKeys = await keysOf(oldRun);
      await purge.process(job);
      expect(await rows(oldRun)).toHaveLength(0);
      expect((await stepsOf(oldRun)).every((s) => s.logStorageKey === null)).toBe(true);
      expect([...deleted].sort()).toEqual([...oldKeys].sort());
      for (const key of oldKeys) expect(h.storage.has(key)).toBe(false);
      expect(await keysOf(freshRun)).toEqual(freshKeys);
      for (const key of freshKeys) expect(h.storage.has(key)).toBe(true);
      const kept = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRun.count({ where: { id: { in: [oldRun, freshRun] } } }));
      expect(kept).toBe(2);
      // a second pass finds nothing
      deleted.length = 0;
      await purge.process(job);
      expect(deleted).toEqual([]);
    });
  });
});
