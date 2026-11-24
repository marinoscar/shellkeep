// =============================================================================
// Binds the `server-profiles` export source to the sharing slice (issue #68)
// =============================================================================
//
// The export source is a plain object (no injection) and the sharing conformance suite forbids a
// direct read of the groups tables, so this provider hands the source the slice's own
// `PrincipalGroupsProvider` when the application is composed.
// =============================================================================

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';

import { bindExportGroupsResolver } from './server-profiles.export-source';

@Injectable()
export class ServerProfilesExportBinding implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly groups: PrincipalGroupsProvider) {}

  onModuleInit(): void {
    bindExportGroupsResolver((principal) => this.groups.groupsFor(principal));
  }

  onModuleDestroy(): void {
    bindExportGroupsResolver(null);
  }
}
