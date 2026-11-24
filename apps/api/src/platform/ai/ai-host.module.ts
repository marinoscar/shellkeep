// =============================================================================
// The AI slice's host ports (issue #55)
// =============================================================================
//
//   AI_SYSTEM_PRISMA    -> PrismaSystemService.forSystem   (the bypass client behind the
//                          two retention purges, the deployment-wide usage report and
//                          the catalogue sync's organization-less usage row)
//   AI_OBJECT_STORE     -> AiObjectStoreAdapter            (the active STORAGE_PROVIDER)
//   AI_METRICS          -> AppMetricsService               (the host core's instruments)
//   AI_TARGET_RESOLVER  -> DefaultAiTargetResolver         (the platform's own order;
//                          ShellKeep has no resolver of its own yet)
//
// `@Global()` because every sub-module of the AI slice injects the ports.
// =============================================================================

import { Global, Module } from '@nestjs/common';

import {
  AI_METRICS,
  AI_OBJECT_STORE,
  AI_SYSTEM_PRISMA,
  AI_TARGET_RESOLVER,
  AiCoreModule,
  DefaultAiTargetResolver,
  type AiSystemPrisma,
} from '@marinoscar/platform-api/ai';
import { AppMetricsService } from '@marinoscar/platform-api/host';
import { StorageProvidersModule } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { AiObjectStoreAdapter } from './ai-object-store.adapter';

@Global()
@Module({
  imports: [AiCoreModule, StorageProvidersModule],
  providers: [
    {
      provide: AI_SYSTEM_PRISMA,
      inject: [PrismaSystemService],
      useFactory: (system: PrismaSystemService): AiSystemPrisma => ({
        asSystem: (reason) =>
          system.forSystem(reason) as unknown as ReturnType<AiSystemPrisma['asSystem']>,
      }),
    },
    { provide: AI_OBJECT_STORE, useClass: AiObjectStoreAdapter },
    { provide: AI_METRICS, useExisting: AppMetricsService },
    DefaultAiTargetResolver,
    { provide: AI_TARGET_RESOLVER, useExisting: DefaultAiTargetResolver },
  ],
  exports: [AI_SYSTEM_PRISMA, AI_OBJECT_STORE, AI_METRICS, AI_TARGET_RESOLVER],
})
export class AiHostModule {}
