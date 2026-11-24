// =============================================================================
// `servers.user_data.purge`: a user's server profiles and their saved credentials (issue #69)
// =============================================================================
//
// Enqueued by `user.data.purge` (subject `user:<userId>`) for the `servers` category, through the
// `delegate` hint of the `ServerProfile` model (`app-registrations/user-data.ts`).
//
//   1. Rows         one bypass transaction: the pending jobs about those profiles, the grants on them
//                   (`deleteGrantsForResources`: a grant has no foreign key to its record) and the
//                   profiles. A group-owned profile the user created goes too: its SSH secrets are the
//                   creator's (the credential store is keyed by `server_profiles.user_id` and never
//                   moves), so a profile without them would be unusable for the group.
//   2. Credentials  every `ssh` credential of the user, through `UserCredentialsService` (never raw SQL
//                   on `user_credentials`). Rows first, credentials second: a retry after a failure
//                   between the two finds no rows and deletes what is left, and a profile never exists
//                   without its secrets.
//
// IDEMPOTENT: a retry (the queue is at-least-once) finds nothing and counts zero. SERVER-ONLY,
// permanently: it carries neither `nodeResultSchema` nor `persistNodeResult` (it deletes across tables
// with the bypass client and holds the credential store).
//
// LOGGING: ids and counts only. A hostname, a username and a credential name never reach a log line.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { deleteGrantsForResources } from '@marinoscar/platform-api/sharing';
import { STORAGE_PROVIDER, deleteStorageKeys, type StorageProvider } from '@marinoscar/platform-api/storage';
import { USER_DATA_DB, type UserDataDbPort } from '@marinoscar/platform-api/user-data';

import { SERVER_PROFILE_RESOURCE } from '../../app-registrations/sharing';
import { SSH_CREDENTIAL_PURPOSE } from '../ssh-credentials';
import { SERVERS_USER_DATA_PURGE_JOB_TYPE, serversUserDataPurgePayloadSchema } from './servers-purge.job-type';

/** What one run deleted (counts only). */
export interface ServersPurgeResult {
  profiles: number;
  grants: number;
  cancelledJobs: number;
  credentials: number;
  /** Folder archive objects (#158) deleted from storage. */
  archiveObjects: number;
}

@Injectable()
export class ServersUserDataPurgeHandler implements JobHandler, OnModuleInit {
  readonly type = SERVERS_USER_DATA_PURGE_JOB_TYPE;
  readonly label = 'Server profile deletion';
  readonly profile = { maxRuntimeMs: 5 * 60_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(ServersUserDataPurgeHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly credentials: UserCredentialsService,
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const parsed = serversUserDataPurgePayloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new Error(`${this.type} job ${job.id}: payload must carry { userId (uuid) }`);
    const result = await this.purge(parsed.data.userId);
    this.logger.log(
      `${this.type} job ${job.id}: ${result.profiles} profile(s), ${result.grants} grant(s), ${result.credentials} credential(s) and ${result.archiveObjects} archive object(s) deleted, ${result.cancelledJobs} job(s) cancelled`,
    );
  }

  /** Deletes one user's profiles, the grants on them and their saved credentials. */
  async purge(userId: string): Promise<ServersPurgeResult> {
    // 0. The user's folder archives (#158): the stored objects first, then the rows. A failed object delete
    //    throws, the retry starts over (the keys are re-read), so no row ever outlives its object's key.
    const keys: string[] = await this.db.runAsSystem('purge', async (tx) => {
      const archives: { storageKey: string | null }[] = await tx.fileArchive.findMany({ where: { userId, storageKey: { not: null } }, select: { storageKey: true } });
      return archives.flatMap((archive) => (archive.storageKey ? [archive.storageKey] : []));
    });
    for (let at = 0; at < keys.length; at += 200) {
      const { failed } = await deleteStorageKeys(this.storage, keys.slice(at, at + 200));
      if (failed.length > 0) throw new Error(`${this.type}: ${failed.length} archive object(s) could not be deleted from storage`);
    }
    await this.db.runAsSystem('purge', (tx) => tx.fileArchive.deleteMany({ where: { userId } }));

    const rows = await this.db.runAsSystem('purge', async (tx) => {
      const profiles: { id: string }[] = await tx.serverProfile.findMany({ where: { userId }, select: { id: true } });
      const ids = profiles.map((profile) => profile.id);
      if (ids.length === 0) return { profiles: 0, grants: 0, cancelledJobs: 0 };
      const cancelled = await tx.job.deleteMany({ where: { status: 'pending', subjectId: { in: ids } } });
      const grants = await deleteGrantsForResources(tx, SERVER_PROFILE_RESOURCE, ids);
      // Sessions of these profiles cascade; the `sessions` category counts its own rows first.
      const deleted = await tx.serverProfile.deleteMany({ where: { userId } });
      return { profiles: deleted.count as number, grants, cancelledJobs: cancelled.count as number };
    });

    let credentials = 0;
    for (const info of await this.credentials.list(userId, SSH_CREDENTIAL_PURPOSE)) {
      await this.credentials.deleteSecret(userId, SSH_CREDENTIAL_PURPOSE, info.name);
      credentials += 1;
    }
    return { ...rows, credentials, archiveObjects: keys.length };
  }
}
