// =============================================================================
// Listing the objects under `file-archives/` (issue #158)
// =============================================================================
//
// `StorageProvider` has no list-by-prefix call; the listing lives on the DRIVER (`StorageDriver.listKeys`), which
// `npm run storage:purge` uses. This port reaches it the way `runStoragePurge` does: the active configuration of
// `StorageConfigService`, then the driver registered for its provider. A deployment whose driver has no
// `listKeys` (or with no storage configured) answers `null` and the orphan sweep is skipped (logged).
// Keys only: no age, no size. The sweep reads the age from the `created-at` metadata the handler sets at upload.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DEFAULT_STORAGE_PART_SIZE_BYTES, StorageConfigService, requireStorageDriver } from '@marinoscar/platform-api/storage';

export const ARCHIVE_OBJECT_LISTER = Symbol('ARCHIVE_OBJECT_LISTER');

export interface ArchiveObjectLister {
  /** Every key under `prefix`, in key order, or `null` when this deployment's storage cannot list. */
  listKeys(prefix: string): Promise<AsyncIterable<string> | null>;
}

@Injectable()
export class DriverArchiveObjectLister implements ArchiveObjectLister {
  private readonly logger = new Logger(DriverArchiveObjectLister.name);

  constructor(private readonly modules: ModuleRef) {}

  async listKeys(prefix: string): Promise<AsyncIterable<string> | null> {
    const storage = this.modules.get(StorageConfigService, { strict: false });
    const config = await storage.resolveActiveConfig({ fresh: true });
    if (!config) return null;
    const driver = requireStorageDriver(config.provider);
    if (!driver.listKeys) return null;
    const ctx = {
      settings: config.settings,
      secret: async (name: string) => config.secrets[name] ?? null,
      logger: this.logger,
      partSize: DEFAULT_STORAGE_PART_SIZE_BYTES,
    };
    return driver.listKeys(ctx as never, prefix);
  }
}
