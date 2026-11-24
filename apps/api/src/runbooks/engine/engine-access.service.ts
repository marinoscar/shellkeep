// =============================================================================
// Who a run acts as, and what they may still do (issue #62)
// =============================================================================
//
// A run executes AS ITS INITIATOR, not as the platform: targets are resolved with the initiator's access,
// and each target job re-checks, at execution time, that the initiator still holds `runbooks:run` and can
// still use the server's credential. A permission revoked after the run was queued therefore stops the
// next target (`PERMISSION_REVOKED`), it does not ride on a decision made hours earlier.
//
// THIS ONE FILE is the engine's seam to the access model. The sharing work (#71) changes the callees
// (`requireRun`, `TargetResolverService.resolve(principal)`, `getDecryptedProfile(id, principal, 'run')`):
// when it lands, only the four calls below change.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { PRINCIPAL_USER_INCLUDE, principalFactory } from '@marinoscar/platform-api/identity';
import type { UserPrincipal } from '@marinoscar/platform-api/core';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import type { OwnerScope } from '../../common/types/owner-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { ServerProfilesService, type DecryptedProfile } from '../../server-profiles/server-profiles.service';
import { RunbooksService } from '../runbooks.service';
import type { TargetSelector } from '../schema/runbook-definition.schema';
import { TargetResolverService, type ResolvedTargets } from '../target-resolver.service';

/** The person a run acts as. */
export interface Initiator {
  principal: UserPrincipal;
  scope: OwnerScope;
}

@Injectable()
export class EngineAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: TargetResolverService,
    private readonly profiles: ServerProfilesService,
    private readonly runbooks: RunbooksService,
  ) {}

  /** The initiator as they are NOW; `null` when the account is gone or disabled. */
  async load(userId: string, orgId: string): Promise<Initiator | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    if (!user || !user.isActive) return null;
    const principal = principalFactory.forUser({ ...user, activeOrgId: orgId }, 'session');
    return { principal, scope: { userId, orgId } };
  }

  canRun(initiator: Initiator): boolean {
    return initiator.principal.permissions.includes(PERMISSIONS.RUNBOOKS_RUN);
  }

  /** Throws (404/403) when the initiator may not run this runbook. */
  async requireRun(initiator: Initiator, runbookId: string): Promise<void> {
    await this.runbooks.findOne(initiator.scope, runbookId);
  }

  resolveTargets(initiator: Initiator, selector: Partial<TargetSelector>, limit?: number): Promise<ResolvedTargets> {
    return this.resolver.resolve(initiator.scope, selector, limit === undefined ? {} : { limit });
  }

  /** The decrypted profile for a run; throws when the initiator may not use it. */
  decryptProfile(initiator: Initiator, serverProfileId: string): Promise<DecryptedProfile> {
    return this.profiles.getDecryptedProfile(serverProfileId, initiator.scope);
  }
}
