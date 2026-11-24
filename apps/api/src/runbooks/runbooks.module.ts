import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { RunbooksController } from './runbooks.controller';
import { RunbooksService } from './runbooks.service';
import { TargetResolverService } from './target-resolver.service';

/**
 * Runbooks (#61): versioned multi-step procedure definitions, target resolution and the
 * secret parameters of an organization. The runbook events and error codes are registered at
 * import time by `runbooks.registrations.ts` (before the registries freeze).
 */
@Module({
  imports: [PrismaModule],
  controllers: [RunbooksController],
  providers: [RunbooksService, TargetResolverService],
  exports: [RunbooksService, TargetResolverService],
})
export class RunbooksModule {}
