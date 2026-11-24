// =============================================================================
// Event listeners of the runbook artifacts (issue #63)
// =============================================================================
//
// Both only enqueue or record (`on-event-no-io`): no download, no upload, no work.
//   - `RunbookRunFinished` (after the run's final commit; never for a dry run): queue the bundle when the
//     run stored at least one log archive. The `runbook.artifacts.bundle` job does the work.
//   - `sharing.grant.created` of a LINK to a `runbook_run`: audit `runbook_artifact.link_created` (ids and
//     the role only; never the token). The sharing slice audits the grant itself as `grant:link:create`.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { SHARING_EVENTS, type GrantEventPayload } from '@marinoscar/platform-api/sharing';

import { recordAudit } from '../../common/audit/record-audit';
import { RunbookRunFinished, RUNBOOK_RUN_FINISHED_EVENT } from '../engine/run-finished.event';
import { RUNBOOK_RUN_RESOURCE } from '../sharing/runbook-run.resource';
import { RunbookArtifactsService } from './runbook-artifacts.service';

@Injectable()
export class RunbookArtifactsListeners {
  private readonly logger = new Logger(RunbookArtifactsListeners.name);

  constructor(
    private readonly artifacts: RunbookArtifactsService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  @OnEvent(RUNBOOK_RUN_FINISHED_EVENT)
  onRunFinished(event: RunbookRunFinished): void {
    void this.artifacts.bundleIfCollected(event.orgId, event.runId);
  }

  @OnEvent(SHARING_EVENTS.GRANT_CREATED)
  onGrantCreated(payload: GrantEventPayload): void {
    if (payload.resourceType !== RUNBOOK_RUN_RESOURCE || payload.granteeKind !== 'link') return;
    void recordAudit(this.audit, this.logger, {
      action: 'runbook_artifact.link_created',
      actorUserId: payload.actorUserId,
      targetType: 'runbook_run',
      targetId: payload.resourceId,
      meta: { grantId: payload.grantId, role: payload.role },
    });
  }
}
