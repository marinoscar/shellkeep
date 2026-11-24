import { Module } from '@nestjs/common';
import { OrgCredentialsModule } from '@marinoscar/platform-api/credentials';

import { sharingModule } from '../platform/sharing/sharing.config';
import { PrismaModule } from '../prisma/prisma.module';
import { RunbookSecretsController } from './runbook-secrets.controller';
import { RunbooksController } from './runbooks.controller';
import { RunbooksService } from './runbooks.service';
import { TargetResolverService } from './target-resolver.service';
import { RunbooksUserDataPurgeHandler } from './user-data/runbooks-purge.handler';
import { UserDataHostModule } from '../platform/user-data/user-data-host.module';

/**
 * Runbooks (#61): versioned multi-step procedure definitions, target resolution and the
 * secret parameters of an organization. The runbook events and error codes are registered at
 * import time by `runbooks.registrations.ts` (before the registries freeze).
 */
@Module({
  imports: [PrismaModule, OrgCredentialsModule, sharingModule, UserDataHostModule],
  controllers: [RunbooksController, RunbookSecretsController],
  // `RunbooksUserDataPurgeHandler` (#69) is the delegated half of the user-data purge.
  providers: [RunbooksService, TargetResolverService, RunbooksUserDataPurgeHandler],
  exports: [RunbooksService, TargetResolverService],
})
export class RunbooksModule {}
