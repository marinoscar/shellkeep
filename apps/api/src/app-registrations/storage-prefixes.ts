import type { StorageKeyPrefixDef } from '@marinoscar/platform-api/storage';

/**
 * ShellKeep's own object-storage key prefixes (issue #50), in purge order after
 * the platform's `uploads/`, `avatars/`, `node-outputs/` and `storage-config-test/`.
 *
 * Declare every prefix a writer of this app uses, or `npm run storage:purge`
 * leaves its objects in the bucket. Name the writer's constant `*_KEY_PREFIX`.
 * A prefix ends with exactly one `/` and must not overlap another registered
 * prefix. Both are organization scoped: a key is built with `buildObjectKey`
 * and carries the organization segment, so the slice's purge of one organization
 * (offboarding) reaches it.
 */
export const APP_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = [
  {
    id: 'session-logs',
    prefix: 'session-logs/',
    owner: 'terminal',
    scope: 'org',
    description: 'Terminal session transcripts and history snapshots',
  },
  {
    id: 'runbook-artifacts',
    prefix: 'runbook-artifacts/',
    owner: 'runbooks',
    scope: 'org',
    description: 'Runbook step logs, collected files and log bundles',
  },
  {
    id: 'file-archives',
    prefix: 'file-archives/',
    owner: 'files',
    scope: 'org',
    description: 'Folder archives (tar.gz) built from a server folder; expire after 24 hours',
  },
];
