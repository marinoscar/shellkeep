import { Module } from '@nestjs/common';
import { OrgCredentialsModule } from '@marinoscar/platform-api/credentials';

import { sharingModule } from '../platform/sharing/sharing.config';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SshModule } from '../ssh/ssh.module';
import { StorageModule, StorageProvidersModule } from '../platform/storage/storage.config';
import { EngineAccessService } from './engine/engine-access.service';
import { EngineMetricsService } from './engine/engine-metrics.service';
import { LogArchiveService } from './engine/log-archive.service';
import { LogsCompactHandler } from './engine/logs-compact.handler';
import { RunAdvanceHandler } from './engine/run-advance.handler';
import { RunCoordinatorService } from './engine/run-coordinator.service';
import { RunEventsService } from './engine/run-events.service';
import { RunFileSource } from './engine/run-file-source';
import { RunLifecycleService } from './engine/run-lifecycle.service';
import { RunStartHandler } from './engine/run-start.handler';
import { RunStreamService } from './engine/run-stream.service';
import { RunbookApprovalsController } from './engine/runbook-approvals.controller';
import { RunbookApprovalsService } from './engine/runbook-approvals.service';
import { RunbookJobSettledListener } from './engine/runbook-job-settled.listener';
import { RunbookReconcileTask } from './engine/runbook-reconcile.task';
import { RunbookRunsController } from './engine/runbook-runs.controller';
import { RunbookRunsService } from './engine/runbook-runs.service';
import { RunbookSettingsService } from './engine/runbook-settings.service';
import { SshExecutor } from './engine/ssh-executor';
import { TargetRunHandler } from './engine/target-run.handler';
import { RunbookAuditController } from './safety/runbook-audit.controller';
import { RunbookAuditService } from './safety/runbook-audit.service';
import { RunbookRiskService } from './safety/runbook-risk.service';
import { RunbookSecretsController } from './runbook-secrets.controller';
import { RunbooksController } from './runbooks.controller';
import { RunbooksService } from './runbooks.service';
import { TargetResolverService } from './target-resolver.service';

/**
 * Runbooks: versioned multi-step procedure definitions, target resolution and the secret parameters of an
 * organization (#61), and the execution engine (#62): runs, approvals, the live stream and the four queue
 * jobs (`runbook.run.start`, `runbook.target.run`, `runbook.run.advance`, `runbook.logs.compact`). The
 * runbook events, error codes and the reconcile access reason are registered at import time by
 * `runbooks.registrations.ts` (before the registries freeze).
 */
@Module({
  imports: [PrismaModule, OrgCredentialsModule, ServerProfilesModule, SshModule, StorageModule, StorageProvidersModule, sharingModule],
  controllers: [RunbooksController, RunbookSecretsController, RunbookRunsController, RunbookApprovalsController, RunbookAuditController],
  providers: [
    RunbooksService,
    TargetResolverService,
    RunbookRiskService,
    RunbookAuditService,
    // The engine
    RunbookSettingsService,
    EngineMetricsService,
    EngineAccessService,
    RunEventsService,
    RunCoordinatorService,
    RunLifecycleService,
    RunbookRunsService,
    RunbookApprovalsService,
    RunStreamService,
    LogArchiveService,
    RunFileSource,
    SshExecutor,
    // Queue handlers (self-register in onModuleInit), the settled-job listener and the reconcile cron
    RunStartHandler,
    TargetRunHandler,
    RunAdvanceHandler,
    LogsCompactHandler,
    RunbookJobSettledListener,
    RunbookReconcileTask,
  ],
  exports: [RunbooksService, TargetResolverService, RunbookRunsService, RunCoordinatorService, RunEventsService],
})
export class RunbooksModule {}
