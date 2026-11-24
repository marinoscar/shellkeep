// =============================================================================
// The REAL user-data services over a row-level-security database (issue #69)
// =============================================================================
//
// Builds the slice's runner, handlers and plan exactly as the app wires them (the app's
// `UserDataDbAdapter` over `PrismaSystemService`, the real `JobsService`, the planner reading the app's
// composed schema, ShellKeep's two delegated purge handlers over the REAL `UserCredentialsService`), on a
// throwaway database owned by an ORDINARY role (`createRlsDatabase`), so a row hidden by row-level security
// would make these suites fail. The storage provider and the audit sink are recording doubles.
//
// Every name is invented (`example.test` hosts, `Person` names); no secret-shaped literal sits in the
// source: the credential values are assembled at run time.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { randomBytes, randomUUID } from 'node:crypto';

import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import { JobsService, type Job } from '@marinoscar/platform-api/jobs';
import { readSchemaDatamodel } from '@marinoscar/platform-api/testing';
import { FactoryResetHandler, UserDataPlanService, UserPurgeRunner, resolveUserDataModuleOptions } from '@marinoscar/platform-api/user-data';

// The app's registries, as the running app fills them.
import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';
import '../../src/platform/storage/storage-key-prefix.manifest';
import '../../src/platform/user-data/user-data.manifest';
import { appSchemaPath } from '../../src/platform/user-data/user-data.config';
import { UserDataDbAdapter } from '../../src/platform/user-data/user-data-db.adapter';
import { SERVER_PROFILE_RESOURCE, RUNBOOK_RESOURCE } from '../../src/app-registrations/sharing';
import { RunbooksUserDataPurgeHandler } from '../../src/runbooks/user-data/runbooks-purge.handler';
import { RUNBOOKS_USER_DATA_PURGE_JOB_TYPE } from '../../src/runbooks/user-data/runbooks-purge.job-type';
import { ServersUserDataPurgeHandler } from '../../src/server-profiles/user-data/servers-purge.handler';
import { SERVERS_USER_DATA_PURGE_JOB_TYPE } from '../../src/server-profiles/user-data/servers-purge.job-type';
import { sshCredentialName, SSH_CREDENTIAL_PURPOSE } from '../../src/server-profiles/ssh-credentials';
import { rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';

export interface UserDataDb {
  runner: UserPurgeRunner;
  factory: FactoryResetHandler;
  servers: ServersUserDataPurgeHandler;
  runbooks: RunbooksUserDataPurgeHandler;
  credentials: UserCredentialsService;
  jobs: JobsService;
  storage: { deleted: string[]; delete(key: string): Promise<void>; abortMultipartUpload(): Promise<void> };
  audit: Array<{ action: string; meta?: unknown }>;
  close(): Promise<void>;
}

/** The slice over `db`. */
export function userDataServices(db: RlsDatabase): UserDataDb {
  process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  const { prisma, system, close } = rlsServices(db);
  const port = new UserDataDbAdapter(system);
  const resolved = resolveUserDataModuleOptions({
    datamodel: () => readSchemaDatamodel(appSchemaPath()),
    userRemovalHooks: [],
    factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
  });
  const plans = new UserDataPlanService(resolved);
  plans.onModuleInit();
  const jobs = new JobsService(prisma as never);
  const deleted: string[] = [];
  const storage = {
    deleted,
    async delete(key: string) {
      deleted.push(key);
    },
    async abortMultipartUpload() {},
  };
  const audit: UserDataDb['audit'] = [];
  const sink = { record: async (event: { action: string; meta?: unknown }) => void audit.push(event) };
  const runner = new UserPurgeRunner(port, storage as never, plans, jobs, sink as never, resolved);
  const registry = { register: () => undefined };
  const credentials = new UserCredentialsService(prisma as never);
  return {
    runner,
    factory: new FactoryResetHandler(registry as never, port, storage as never, plans, runner, sink as never, resolved),
    servers: new ServersUserDataPurgeHandler(registry as never, credentials, port),
    runbooks: new RunbooksUserDataPurgeHandler(registry as never, port),
    credentials,
    jobs,
    storage,
    audit,
    close,
  };
}

/** One transaction on the bypass pool of `db`. */
export function sys<R = any>(db: RlsDatabase, fn: (tx: any) => Promise<R>): Promise<R> {
  return db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    return fn(tx);
  });
}

/** Inserts a running job row the handler under test can write its payload to. */
export function runningJob(db: RlsDatabase, type: string, payload: Record<string, unknown>, subject?: { type: string; id: string }): Promise<Job> {
  return sys(db, (tx) =>
    tx.job.create({
      data: { type, reason: 'rerun', status: 'running', payload, ...(subject ? { subjectType: subject.type, subjectId: subject.id } : {}) },
    }),
  );
}

/**
 * Runs `user.data.purge` for one user as the worker does: the job, then every delegated job it queued
 * (each marked finished afterwards, so the queue's active dedup frees the slot).
 */
export async function runPurge(db: RlsDatabase, svc: UserDataDb, userId: string, scope: string) {
  const job = await runningJob(db, 'user.data.purge', { userId, scope }, { type: 'user', id: userId });
  const result = await svc.runner.runJob(job, { userId, scope });
  const delegated = await sys(db, (tx) =>
    tx.job.findMany({ where: { subjectType: 'user', subjectId: userId, status: 'pending', type: { in: [SERVERS_USER_DATA_PURGE_JOB_TYPE, RUNBOOKS_USER_DATA_PURGE_JOB_TYPE] } } }),
  );
  for (const row of delegated as Job[]) {
    const handler = row.type === SERVERS_USER_DATA_PURGE_JOB_TYPE ? svc.servers : svc.runbooks;
    await handler.process(row);
    await sys(db, (tx) => tx.job.update({ where: { id: row.id }, data: { status: 'succeeded', finishedAt: new Date() } }));
  }
  await sys(db, (tx) => tx.job.update({ where: { id: job.id }, data: { status: 'succeeded', finishedAt: new Date() } }));
  return { result, delegatedTypes: (delegated as Job[]).map((row) => row.type).sort() };
}

/** What `seedShellkeepUser` created. */
export interface SeededUser {
  userId: string;
  email: string;
  orgId: string;
  /** A personal profile, a profile a group owns (both created by the user) and the grantee's share of the first. */
  profileIds: string[];
  groupProfileId: string;
  sessionIds: string[];
  /** The `ssh` credential names saved for the user. */
  credentialNames: string[];
  /** A runbook only the user owns (with two versions) and one a group owns. */
  ownRunbookId: string;
  groupRunbookId: string;
  /** The user's storage object keys (a profile image and a log, uploaded by them). */
  objectKeys: string[];
}

/** The default organization (created by the migrations). */
export const defaultOrgId = (db: RlsDatabase): Promise<string> => sys(db, async (tx) => (await tx.organization.findFirstOrThrow({ where: { isDefault: true } })).id);

/** A group in `orgId`, with `adminId` as its admin. */
export async function seedGroup(db: RlsDatabase, orgId: string, adminId: string, name = 'Group Alpha'): Promise<string> {
  return sys(db, async (tx) => {
    const group = await tx.group.create({ data: { orgId, name, createdById: adminId } });
    await tx.groupMember.create({ data: { groupId: group.id, orgId, userId: adminId, role: 'admin' } });
    return group.id as string;
  });
}

/**
 * A user with every kind of ShellKeep row: two profiles (one owned by `groupId`) with `ssh` credentials saved
 * through the REAL credential store, two sessions, a runbook only they own (two versions) and one `groupId`
 * owns, grants on the profile and the runbook to `granteeId`, and two storage objects. Invented names only.
 */
export async function seedShellkeepUser(
  db: RlsDatabase,
  svc: UserDataDb,
  options: { name: string; orgId: string; groupId: string; granteeId: string },
): Promise<SeededUser> {
  const { orgId, groupId, granteeId } = options;
  const userId = randomUUID();
  const email = `${options.name}-${randomUUID().slice(0, 6)}@example.test`;
  const tag = randomUUID().slice(0, 8);
  const objectKeys = [`uploads/${orgId}/${tag}-log.txt`, `avatars/${orgId}/${tag}.png`];
  const profileIds = [randomUUID(), randomUUID()];
  const groupProfileId = randomUUID();
  const sessionIds = [randomUUID(), randomUUID()];
  const ownRunbookId = randomUUID();
  const groupRunbookId = randomUUID();

  await sys(db, async (tx) => {
    const viewer = (await tx.role.findFirst({ where: { name: 'viewer' } })) ?? (await tx.role.create({ data: { name: 'viewer', description: 'viewer', scope: 'org' } }));
    await tx.user.create({ data: { id: userId, email, providerDisplayName: email, displayName: `Person ${tag}` } });
    await tx.membership.create({ data: { orgId, userId, roleId: viewer.id, status: 'active' } });
    await tx.groupMember.create({ data: { groupId, orgId, userId, role: 'editor' } });
    const profile = { userId, orgId, hostname: `${tag}.example.test`, username: 'ops', authMethod: 'password' as const };
    await tx.serverProfile.create({ data: { ...profile, id: profileIds[0], name: `Server ${tag} one` } });
    await tx.serverProfile.create({ data: { ...profile, id: profileIds[1], name: `Server ${tag} two` } });
    await tx.serverProfile.create({ data: { ...profile, id: groupProfileId, name: `Server ${tag} group`, ownerGroupId: groupId } });
    for (const [index, id] of sessionIds.entries()) {
      await tx.terminalSession.create({
        data: { id, userId, orgId, serverProfileId: profileIds[index]!, name: `Session ${tag} ${index}`, tmuxSessionId: `tmux-${tag}-${index}`, status: index === 0 ? 'active' : 'detached' },
      });
    }
    for (const [id, ownerGroupId] of [[ownRunbookId, null], [groupRunbookId, groupId]] as const) {
      await tx.runbook.create({ data: { id, orgId, ownerUserId: userId, ownerGroupId, name: `Runbook ${tag} ${ownerGroupId ? 'group' : 'own'}` } });
      for (const version of [1, 2]) {
        await tx.runbookVersion.create({
          data: { orgId, runbookId: id, version, definition: { schemaVersion: 1, steps: [] }, definitionSha256: 'a'.repeat(64), createdBy: userId },
        });
      }
    }
    for (const [resourceType, resourceId] of [
      [SERVER_PROFILE_RESOURCE, profileIds[0]!],
      [SERVER_PROFILE_RESOURCE, groupProfileId],
      [RUNBOOK_RESOURCE, ownRunbookId],
      [RUNBOOK_RESOURCE, groupRunbookId],
    ] as const) {
      await tx.grant.create({ data: { orgId, resourceType, resourceId, granteeKind: 'user', granteeUserId: granteeId, role: 'viewer', grantedById: userId } });
    }
    for (const key of objectKeys) {
      await tx.storageObject.create({ data: { name: 'f.bin', size: 3, mimeType: 'application/octet-stream', storageKey: key, orgId, uploadedById: userId, status: 'ready' } });
    }
  });

  // Credentials through the REAL store, so the ciphertext is real; the values are assembled here.
  const credentialNames: string[] = [];
  for (const id of [...profileIds, groupProfileId]) {
    const name = sshCredentialName(id, 'password');
    await svc.credentials.setSecret(userId, SSH_CREDENTIAL_PURPOSE, name, ['pw', randomUUID()].join('-'));
    credentialNames.push(name);
  }
  return { userId, email, orgId, profileIds, groupProfileId, sessionIds, credentialNames, ownRunbookId, groupRunbookId, objectKeys };
}

/** What of a user's ShellKeep data remains, read on the bypass pool. */
export async function shellkeepCounts(db: RlsDatabase, user: SeededUser) {
  const { userId } = user;
  const resources = [...user.profileIds, user.groupProfileId, user.ownRunbookId, user.groupRunbookId];
  return sys(db, async (tx) => ({
    profiles: await tx.serverProfile.count({ where: { userId } }),
    sessions: await tx.terminalSession.count({ where: { userId } }),
    sshCredentials: await tx.userCredential.count({ where: { userId, purpose: SSH_CREDENTIAL_PURPOSE } }),
    ownRunbooks: await tx.runbook.count({ where: { id: user.ownRunbookId } }),
    ownRunbookVersions: await tx.runbookVersion.count({ where: { runbookId: user.ownRunbookId } }),
    groupRunbooks: await tx.runbook.count({ where: { id: user.groupRunbookId } }),
    groupRunbookVersions: await tx.runbookVersion.count({ where: { runbookId: user.groupRunbookId } }),
    groupRunbookAuthored: await tx.runbook.count({ where: { id: user.groupRunbookId, ownerUserId: userId } }),
    grants: await tx.grant.count({ where: { resourceId: { in: resources } } }),
    objects: await tx.storageObject.count({ where: { uploadedById: userId } }),
    user: await tx.user.count({ where: { id: userId } }),
    membership: await tx.membership.count({ where: { userId } }),
    groupMember: await tx.groupMember.count({ where: { userId } }),
  }));
}
