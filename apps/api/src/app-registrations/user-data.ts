// =============================================================================
// ShellKeep's user-data declarations (issue #69)
// =============================================================================
//
// Pure data, no Nest and no services: `platform/user-data/user-data.manifest.ts` registers them after
// `registerPlatformUserData()` (the platform's categories, hints and reset steps). This file lives here,
// not in `platform/user-data/`, because that folder is base code and may not name the domain
// (`test/architecture/base-domain-boundary.spec.ts`).
//
// WHAT A PURGE DOES, per model (the `user-data` conformance suite fails for a model with an owner column
// and no decision):
//
//   ServerProfile    delete, category `servers`, DELEGATED to `servers.user_data.purge`: the profile's SSH
//                    secrets are in the credential store, which only `UserCredentialsService` may delete.
//   TerminalSession  delete, category `sessions`, inline (children before parents: sessions go first).
//   Runbook          delete, category `runbooks`, DELEGATED to `runbooks.user_data.purge`: a runbook only
//                    the user owns goes; one a group owns stays with the group (author link nulled). The
//                    platform's `keepWhenReferenced` cannot express this (it keeps any row with a
//                    version), so ownership is decided by the delegate.
//   RunbookVersion   not an owner model (`created_by` is an actor): it follows its runbook (cascade). The
//                    hint exists so the factory reset's organization step and the Danger Zone know it.
//
// STORAGE OBJECTS. The user's `StorageObject` rows (every object they uploaded, session logs and runbook
// artifacts included, since each is owned by its uploader) are deleted by the platform's `files` category.
// No ShellKeep model carries a column naming such an object yet (`TerminalSession` has no session-log
// column and the run tables are not in this branch), so no `storageObjectColumns` is declared. When a model
// gains one, name it here: the purge collects the ids BEFORE the row goes.
//
// EXTENSION POINT (the runbook engine, #62, PR #118): the run tables (`RunbookRun`, `RunbookRunTarget`,
// steps, log chunks, command executions, approvals) are added here with their decisions, in the PR that
// lands them. Runs started by the user on a group-owned runbook are kept with the actor id nulled; the
// delegate `runbooks.user_data.purge` is where that happens.
// =============================================================================

import type {
  FactoryResetStepDef,
  OffboardingPreconditionDef,
  UserDataCategoryDef,
  UserDataModelHint,
  UserDataScopeDef,
} from '@marinoscar/platform-api/user-data';
import type { Prisma } from '@prisma/client';

import { RUNBOOKS_USER_DATA_PURGE_JOB_TYPE } from '../runbooks/user-data/runbooks-purge.job-type';
import { SERVERS_USER_DATA_PURGE_JOB_TYPE } from '../server-profiles/user-data/servers-purge.job-type';

/** Category ids. Permanent once a purge result carried them. */
export const SHELLKEEP_USER_DATA_CATEGORY_IDS = {
  SERVERS: 'servers',
  SESSIONS: 'sessions',
  RUNBOOKS: 'runbooks',
} as const;

/** ShellKeep's categories: the Danger Zone rows and what the scopes select. All `content`. */
export const APP_USER_DATA_CATEGORIES: readonly UserDataCategoryDef[] = [
  {
    id: SHELLKEEP_USER_DATA_CATEGORY_IDS.SERVERS,
    label: 'Servers',
    description: 'Server profiles and their saved credentials.',
    content: true,
    order: 60,
  },
  {
    id: SHELLKEEP_USER_DATA_CATEGORY_IDS.SESSIONS,
    label: 'Terminal sessions',
    description: 'Terminal session records and their saved logs.',
    content: true,
    order: 61,
  },
  {
    id: SHELLKEEP_USER_DATA_CATEGORY_IDS.RUNBOOKS,
    label: 'Runbooks',
    description: 'Runbooks you own, their versions, runs and collected artifacts.',
    content: true,
    order: 62,
  },
];

/** The keep-or-delete decision of every ShellKeep owner model. */
export const APP_USER_DATA_MODELS: readonly UserDataModelHint<Prisma.ModelName>[] = [
  {
    model: 'ServerProfile',
    category: SHELLKEEP_USER_DATA_CATEGORY_IDS.SERVERS,
    // The saved credentials (`ssh`, one per secret field) go through `UserCredentialsService` in the job.
    delegate: { jobType: SERVERS_USER_DATA_PURGE_JOB_TYPE, payload: (userId) => ({ userId }) },
  },
  {
    model: 'TerminalSession',
    category: SHELLKEEP_USER_DATA_CATEGORY_IDS.SESSIONS,
  },
  {
    model: 'Runbook',
    category: SHELLKEEP_USER_DATA_CATEGORY_IDS.RUNBOOKS,
    // A runbook a group owns stays with the group; the job decides by `owner_group_id`.
    delegate: { jobType: RUNBOOKS_USER_DATA_PURGE_JOB_TYPE, payload: (userId) => ({ userId }) },
    // The platform prints a model's `summary` only on the pages' "kept" lists, which list models a reset
    // keeps; this one is deleted, so the line is documentation of the rule the job applies.
    summary: 'Runbooks owned by a group stay with the group.',
  },
  {
    model: 'RunbookVersion',
    category: SHELLKEEP_USER_DATA_CATEGORY_IDS.RUNBOOKS,
  },
];

/** ShellKeep's narrow scopes (the "Delete specific data" rows). The phrase is the id upper-cased. */
export const APP_USER_DATA_SCOPES: readonly UserDataScopeDef[] = [
  {
    id: 'servers',
    label: 'Delete my servers and sessions',
    description: 'Every server profile with its saved credentials, and every terminal session. Runbooks and settings stay.',
    categories: [SHELLKEEP_USER_DATA_CATEGORY_IDS.SERVERS, SHELLKEEP_USER_DATA_CATEGORY_IDS.SESSIONS],
    confirmation: 'SERVERS',
    layer: 'specific',
    order: 10,
  },
  {
    id: 'runbooks',
    label: 'Delete my runbooks and run history',
    description: 'Every runbook only you own, with its versions and runs. Runbooks owned by a group stay with the group.',
    categories: [SHELLKEEP_USER_DATA_CATEGORY_IDS.RUNBOOKS],
    confirmation: 'RUNBOOKS',
    layer: 'specific',
    order: 20,
  },
];

/**
 * ShellKeep's factory reset steps, in the order they run.
 *
 * `shellkeep.terminal.disconnect` (phase `before-users`) marks every `active` session `terminated`. The
 * platform deletes every user's rows first (step 2 of the reset), so this step finds the sessions a user
 * opened while the reset was already running, and closes the gap between the row deletes and the removal
 * of the users. It does NO SSH work: killing a remote tmux session is long-running and per-host, and the
 * reaper (`terminal.session.reap`) does not do it either. The tmux sessions already running on the user's
 * servers are left running.
 *
 * `shellkeep.servers.reset` deletes the server profiles the per-user purge skips (it only delegates them:
 * the administrator who runs the reset is never deleted, so their profiles would survive). Their
 * credentials are `UserCredential` rows, deleted by the platform's `credentials` category. It runs before
 * the organization step, which deletes groups (a profile's `owner_group_id` is a `NoAction` key).
 */
export const APP_FACTORY_RESET_STEPS: readonly FactoryResetStepDef[] = [
  {
    id: 'shellkeep.terminal.disconnect',
    phase: 'before-users',
    description: 'Marks every active terminal session terminated; no SSH connection is opened.',
    summary: 'Live terminal connections are closed; tmux sessions already running on your servers are not killed.',
    async run(tx) {
      const { count } = await tx.terminalSession.updateMany({
        where: { status: 'active' },
        data: { status: 'terminated', terminatedAt: new Date() },
      });
      return { sessionsTerminated: count as number };
    },
  },
  {
    id: 'shellkeep.servers.reset',
    phase: 'before-users',
    description: 'Every server profile (the per-user purge delegates them, and the actor is never deleted).',
    summary: 'Every server profile and its saved credentials',
    async run(tx) {
      const { count } = await tx.serverProfile.deleteMany({});
      return { serverProfiles: count as number };
    },
  },
];

/** ShellKeep's offboarding preconditions (none; the exports slice's is registered by the manifest). */
export const APP_OFFBOARDING_PRECONDITIONS: readonly OffboardingPreconditionDef[] = [];
