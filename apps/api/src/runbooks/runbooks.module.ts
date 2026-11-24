import { Module } from '@nestjs/common';
import { OrgCredentialsModule } from '@marinoscar/platform-api/credentials';

import { PrismaModule } from '../prisma/prisma.module';
import { RunbookSecretsController } from './runbook-secrets.controller';
import { RunbooksController } from './runbooks.controller';
import { RunbooksService } from './runbooks.service';
import { TargetResolverService } from './target-resolver.service';

/**
 * Runbooks (#61): versioned multi-step procedure definitions, target resolution and the
 * secret parameters of an organization. The runbook events and error codes are registered at
 * import time by `runbooks.registrations.ts` (before the registries freeze).
 */
@Module({
  imports: [PrismaModule, OrgCredentialsModule],
  controllers: [RunbooksController, RunbookSecretsController],
  providers: [RunbooksService, TargetResolverService],
  exports: [RunbooksService, TargetResolverService],
})
export class RunbooksModule {}
