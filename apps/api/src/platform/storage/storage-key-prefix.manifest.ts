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

import { STORAGE_SLICE_KEY_PREFIXES, registerStorageKeyPrefixes } from '@marinoscar/platform-api/storage';

import { APP_STORAGE_KEY_PREFIXES } from '../../app-registrations/storage-prefixes';

registerStorageKeyPrefixes(STORAGE_SLICE_KEY_PREFIXES);

registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);
