// =============================================================================
// The settings slice's SETTINGS_DATA port (issue #48)
// =============================================================================
//
// `runInOrg` is core's helper over ShellKeep's `PrismaService`: ONE transaction
// whose first statement sets `app.org_id` (and `app.user_id`) transaction-locally
// (`set_config(..., true)`), so the row-level security of `org_settings` confines
// every query to that organization once the API stops connecting as the bootstrap
// superuser (#52). No system client: the org layer never reads across
// organizations.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import type { SettingsDataPort, SettingsOrgTx } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsDataAdapter implements SettingsDataPort {
  constructor(private readonly prisma: PrismaService) {}

  runInOrg<R>(
    scope: { orgId: string; userId?: string },
    fn: (tx: SettingsOrgTx) => Promise<R>,
  ): Promise<R> {
    return runInOrg(this.prisma, scope, (tx) => fn(tx as unknown as SettingsOrgTx));
  }
}
