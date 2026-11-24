// =============================================================================
// Object-storage key prefixes (issue #50)
// =============================================================================
//
// Registered at import time, in purge order, before the application bootstraps
// (the registry freezes then). The storage slice owns `uploads/`, `avatars/`,
// `node-outputs/` and `storage-config-test/`; ShellKeep's own writers declare
// theirs in `app-registrations/storage-prefixes.ts`. `StorageModule.forRoot()`
// registers the slice's four again, which is idempotent.
//
// Every object ShellKeep wrote before the platform storage slice lives under
// `uploads/<timestamp>/<uuid><ext>`; its stored `storage_key` is never rebuilt,
// so nothing moves.
// =============================================================================

import { registerAndroidAppKeyPrefixes } from '@marinoscar/platform-api/android-app';
import { DB_BACKUP_KEY_PREFIX } from '@marinoscar/platform-api/db-backup';
import { EXPORTS_KEY_PREFIXES } from '@marinoscar/platform-api/exports';
import { STORAGE_SLICE_KEY_PREFIXES, registerStorageKeyPrefixes } from '@marinoscar/platform-api/storage';

import { APP_STORAGE_KEY_PREFIXES } from '../../app-registrations/storage-prefixes';

registerStorageKeyPrefixes(STORAGE_SLICE_KEY_PREFIXES);

// The db-backup slice's own `database-backups/` declaration (#52, scope `deployment`, kept by a
// factory reset). `DbBackupModule.forRoot()` registers the same object, idempotently.
registerStorageKeyPrefixes([DB_BACKUP_KEY_PREFIX]);

// The exports slice's `exports/users/` and `exports/orgs/` (#68), so `npm run storage:purge` and
// offboarding reach the files; `ExportsModule.forRoot()` registers the same objects, idempotently.
registerStorageKeyPrefixes(EXPORTS_KEY_PREFIXES);

// The Android companion's `android-releases/` (#74, scope `deployment`, kept by a factory reset).
// `AndroidAppModule.forRoot()` registers the same object, idempotently.
registerAndroidAppKeyPrefixes();

registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);
