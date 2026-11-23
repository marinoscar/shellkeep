// =============================================================================
// The platform storage slice, mounted for ShellKeep (issue #50)
// =============================================================================
//
// `StorageModule.forRoot()` serves the objects API (`/api/storage/objects`),
// `GET /api/storage/status`, the stale-upload sweep and the post-upload
// processing job. `StorageConfigModule` serves `/api/admin/storage-config` and
// the provider-migration routes, and the two storage Doctor checks.
// `ProfileImageModule` serves the profile-image routes.
//
// The provider is runtime configuration: `/admin/settings/storage` (the
// `storage` system namespace plus the encrypted credential store). There is no
// environment-variable path. `npm run storage:import-env` copies the previous
// build's `STORAGE_PROVIDER` / `S3_*` / `AWS_*` variables once.
//
// Imports below run first, in this order: the settings registry (the `storage`
// namespace must be registered before `SettingsModule.forRoot()` composes its
// bodies), then the key prefixes (the registry freezes at bootstrap).
// =============================================================================

import '../settings/registry';
import './storage-key-prefix.manifest';

import {
  ProfileImageModule as PlatformProfileImageModule,
  StorageModule as PlatformStorageModule,
} from '@marinoscar/platform-api/storage';

import { StorageHostModule } from './storage-host.module';

/** The objects API, its status route, the stale-upload sweep and the processing job. */
export const StorageModule = PlatformStorageModule.forRoot({ imports: [StorageHostModule] });

/** The profile-image routes (`/api/user-settings/profile-image`, the public avatar route). */
export const ProfileImageModule = PlatformProfileImageModule.forRoot();

export { StorageConfigModule, StorageProvidersModule } from '@marinoscar/platform-api/storage';
