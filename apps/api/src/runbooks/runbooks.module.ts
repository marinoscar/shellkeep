import { Module } from '@nestjs/common';
import { OrgCredentialsModule } from '@marinoscar/platform-api/credentials';

import { AiModule } from '../platform/ai/ai.config';
import { sharingModule } from '../platform/sharing/sharing.config';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SshModule } from '../ssh/ssh.module';
import { StorageModule, StorageProvidersModule } from '../platform/storage/storage.config';
import { RunbookAgentHandler } from './ai/runbook-agent.handler';
import { RunbookAiController } from './ai/runbook-ai.controller';
import { RunbookAiStopService } from './ai/runbook-ai-stop.service';
import { RunbookDraftController } from './ai/runbook-draft.controller';
import { RunbookDraftService } from './ai/runbook-draft.service';
import { DASHBOARD_RUNS_SOURCE } from '../dashboard/dashboard-runs.source';
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
import { RunsDashboardSource } from './engine/runs-dashboard.source';
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
import { ArtifactsPurgeHandler } from './artifacts/artifacts-purge.handler';
import { BundleHandler } from './artifacts/bundle.handler';
import { PublicRunbookBundleController } from './artifacts/public-runbook-bundle.controller';
import { PublicRunbookBundleService } from './artifacts/public-runbook-bundle.service';
import { RunbookArtifactsController } from './artifacts/runbook-artifacts.controller';
import { RunbookArtifactsListeners } from './artifacts/runbook-artifacts.listeners';
import { RunbookArtifactsService } from './artifacts/runbook-artifacts.service';
import { RunbookAuditController } from './safety/runbook-audit.controller';
import { RunbookAuditService } from './safety/runbook-audit.service';
import { RunbookRiskService } from './safety/runbook-risk.service';
import { RunbookSecretsController } from './runbook-secrets.controller';
import { RunbooksController } from './runbooks.controller';
import { RunbooksService } from './runbooks.service';
import { TargetResolverService } from './target-resolver.service';
import { RunbooksUserDataPurgeHandler } from './user-data/runbooks-purge.handler';
import { UserDataHostModule } from '../platform/user-data/user-data-host.module';

/**
 * Runbooks: versioned multi-step procedure definitions, target resolution and the secret parameters of an
 * organization (#61), and the execution engine (#62): runs, approvals, the live stream and the four queue
 * jobs (`runbook.run.start`, `runbook.target.run`, `runbook.run.advance`, `runbook.logs.compact`). The
 * runbook events, error codes and the reconcile access reason are registered at import time by
 * `runbooks.registrations.ts` (before the registries freeze). #64 adds the AI step: the `ai.runbook.agent` job, "Stop AI" and
 * `POST /api/ai/runbooks/draft`.
 */
@Module({
  imports: [PrismaModule, AiModule, OrgCredentialsModule, ServerProfilesModule, SshModule, StorageModule, StorageProvidersModule, sharingModule, UserDataHostModule],
  controllers: [RunbooksController, RunbookSecretsController, RunbookRunsController, RunbookApprovalsController, RunbookAuditController, RunbookAiController, RunbookDraftController, RunbookArtifactsController, PublicRunbookBundleController],
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
    RunsDashboardSource,
    { provide: DASHBOARD_RUNS_SOURCE, useExisting: RunsDashboardSource },
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
    // Collected logs and the run bundle (#63)
    RunbookArtifactsService,
    PublicRunbookBundleService,
    RunbookArtifactsListeners,
    BundleHandler,
    ArtifactsPurgeHandler,
    // AI steps (#64): the agent job (server-only), "Stop AI" and drafting
    RunbookAgentHandler,
    RunbookAiStopService,
    RunbookDraftService,
    // The delegated half of the user-data purge (#69).
    RunbooksUserDataPurgeHandler,
  ],
  exports: [RunbooksService, TargetResolverService, RunbookRunsService, RunCoordinatorService, RunEventsService, DASHBOARD_RUNS_SOURCE],
})
export class RunbooksModule {}
