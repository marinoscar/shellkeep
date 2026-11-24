import { Body, Controller, Get, Header, HttpCode, HttpStatus, Headers, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';
import { map, type Observable } from 'rxjs';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { CreateRunDto, LogQueryDto, RetryRunDto, RunsQueryDto } from './dto/run.dto';
import { LogArchiveService } from './log-archive.service';
import { RunStreamService } from './run-stream.service';
import { RunbookApprovalsService } from './runbook-approvals.service';
import { RunbookRunsService } from './runbook-runs.service';

/**
 * Runs. Starting one is `POST /api/runbooks/:id/runs`; everything else is under `/api/runbook-runs`.
 * Static and longer paths are declared before the bare `:id` route.
 */
@ApiTags('Runbooks')
@Controller()
export class RunbookRunsController {
  constructor(
    private readonly runs: RunbookRunsService,
    private readonly approvals: RunbookApprovalsService,
    private readonly archive: LogArchiveService,
    private readonly stream: RunStreamService,
  ) {}

  @Post('runbooks/:id/runs')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a run (or a dry run: `dryRun: true`) of a runbook version on a set of servers (requires runbooks:run)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 202,
    description:
      '`{ runId, status: "queued", dryRun, awaitingApproval, approvalId }`: follow the run with GET /api/runbook-runs/{id}. `awaitingApproval: true` is a destructive run parked behind a second person (`approvalId`); it starts when someone else with runbooks:approve approves it.',
  })
  @ApiResponse({
    status: 428,
    description:
      'RUNBOOK_CONFIRMATION_REQUIRED: the runbook has a destructive step. Send `confirm: { runbookName, targetCount }` (the exact name and the resolved server count, both in `details`, with the destructive `findings`). Not needed for `dryRun: true`.',
  })
  @ApiResponse({ status: 422, description: 'RUNBOOK_PARAMS_INVALID (with `details.issues`) or RUNBOOK_SECRET_REF_UNKNOWN' })
  @ApiResponse({ status: 503, description: 'RUNBOOKS_DISABLED' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateRunDto,
  ) {
    return this.runs.create(principal, id, dto);
  }

  @Get('runbook-runs')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiResponse({ status: 200, description: 'Paginated runs' })
  @ApiOperation({ summary: 'List runs, newest first; filter by runbookId, status, trigger, initiatedBy (requires runbooks:read)' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: RunsQueryDto) {
    return this.runs.list(principal, query);
  }

  @Get('runbook-runs/:id')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'A run with its targets, the step matrix and counts (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.runs.get(principal, id);
  }

  @Get('runbook-runs/:id/targets/:targetId/steps/:stepIndex/log')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'The (redacted) log of one step as text; `?tail=N` keeps the last N lines (requires runbooks:read)' })
  @ApiResponse({ status: 200, description: 'text/plain' })
  async log(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Param('stepIndex', ParseIntPipe) stepIndex: number,
    @CurrentPrincipal() principal: Principal,
    @Query() query: LogQueryDto,
  ): Promise<string> {
    const rowId = await this.runs.stepRowId(principal, id, targetId, stepIndex);
    return (await this.archive.readStepLog(principal.activeOrgId!, rowId, query.tail)) ?? '';
  }

  @Sse('runbook-runs/:id/logs/stream')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({
    summary:
      'Live run events (SSE): snapshot, then chunk/step/target/run/approval events; resume with Last-Event-ID `<stepRowId>:<seq>` (requires runbooks:read)',
  })
  @ApiHeader({ name: 'Last-Event-ID', required: false })
  @ApiResponse({ status: 200, description: 'text/event-stream' })
  async runStream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    await this.runs.requireVisible(principal, id);
    return this.toMessages(this.stream.stream({ userId: principal.userId, orgId: principal.activeOrgId! }, id, { ...(lastEventId ? { lastEventId } : {}) }));
  }

  @Sse('runbook-runs/:id/targets/:targetId/logs/stream')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'Live events of one target (SSE); same framing as the run stream (requires runbooks:read)' })
  @ApiHeader({ name: 'Last-Event-ID', required: false })
  @ApiResponse({ status: 200, description: 'text/event-stream' })
  async targetStream(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @CurrentPrincipal() principal: Principal,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    await this.runs.requireVisible(principal, id);
    return this.toMessages(this.stream.stream({ userId: principal.userId, orgId: principal.activeOrgId! }, id, { targetId, ...(lastEventId ? { lastEventId } : {}) }));
  }

  @Post('runbook-runs/:id/cancel')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, description: 'Accepted: `{ id, status }`' })
  @ApiOperation({ summary: 'Cancel a run: pending targets are cancelled, running ones stop within seconds (requires runbooks:run)' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_RUN_STATE: the run already finished' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.runs.cancel(principal, id);
  }

  @Post('runbook-runs/:id/targets/:targetId/cancel')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, description: 'Accepted: `{ id, status }`' })
  @ApiOperation({ summary: 'Cancel one target of a run (requires runbooks:run)' })
  cancelTarget(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.runs.cancelTarget(principal, id, targetId);
  }

  @Post('runbook-runs/:id/retry')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, description: 'Accepted: the same body as starting a run' })
  @ApiResponse({ status: 428, description: 'RUNBOOK_CONFIRMATION_REQUIRED: a retry of a destructive runbook needs `confirm` too' })
  @ApiOperation({ summary: 'Start a new run with the same version and parameters on the failed (or all) servers (requires runbooks:run)' })
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Body() dto: RetryRunDto) {
    return this.runs.retry(principal, id, dto.only, dto.confirm);
  }

  @Post('runbook-runs/:id/resume')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN, PERMISSIONS.RUNBOOKS_APPROVE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, description: 'Accepted' })
  @ApiOperation({ summary: 'Resume a run paused after its canary batch: an approval decision (requires runbooks:run and runbooks:approve)' })
  @ApiResponse({ status: 403, description: 'RUNBOOK_SELF_APPROVAL when the starter of the run may not approve it' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_RUN_STATE: the run is not paused' })
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.approvals.resume(principal, id);
  }

  private toMessages(source: Observable<{ id?: string; type: string; data: unknown }>): Observable<MessageEvent> {
    return source.pipe(map((m) => ({ ...(m.id ? { id: m.id } : {}), type: m.type, data: m.data as object }) as MessageEvent));
  }
}
