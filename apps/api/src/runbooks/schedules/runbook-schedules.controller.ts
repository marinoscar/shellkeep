import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ApproveScheduleDto, CreateScheduleDto, PreviewQueryDto, SchedulesQueryDto, UpdateScheduleDto } from './dto/schedule.dto';
import { RunbookSchedulesService } from './runbook-schedules.service';

/**
 * Runbook schedules (#66). `GET runbook-schedules/preview` is declared before the `:id` routes.
 * A schedule or runbook the caller cannot see is a 404, never a 403.
 */
@ApiTags('Runbooks')
@Controller()
export class RunbookSchedulesController {
  constructor(private readonly schedules: RunbookSchedulesService) {}

  @Get('runbook-schedules/preview')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'The next 5 fire times of a cron expression in a time zone, for the schedule editor (requires runbooks:read)' })
  @ApiResponse({ status: 200, description: '`{ cron, timezone, next: ISO timestamps[] }`' })
  @ApiResponse({ status: 422, description: 'RUNBOOK_SCHEDULE_INVALID (`details.field`: cron or timezone)' })
  preview(@Query() query: PreviewQueryDto) {
    return this.schedules.preview(query.cron, query.timezone);
  }

  @Get('runbooks/:id/schedules')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'List the schedules of a runbook (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated schedules with next run, last run status, approval state and disabledReason' })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Query() query: SchedulesQueryDto) {
    return this.schedules.list(principal, id, query);
  }

  @Get('runbooks/:id/schedules/:scheduleId')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'One schedule (requires runbooks:read)' })
  @ApiResponse({ status: 200, description: 'The schedule' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  get(@Param('id', ParseUUIDPipe) id: string, @Param('scheduleId', ParseUUIDPipe) scheduleId: string, @CurrentPrincipal() principal: Principal) {
    return this.schedules.get(principal, id, scheduleId);
  }

  @Post('runbooks/:id/schedules')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE, PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a schedule; it runs as you (requires runbooks:write and runbooks:run)' })
  @ApiResponse({ status: 201, description: 'The schedule. A destructive runbook is created disabled (`disabledReason: APPROVAL_REQUIRED`) until a second person approves it.' })
  @ApiResponse({ status: 422, description: 'RUNBOOK_SCHEDULE_INVALID, RUNBOOK_PARAMS_INVALID or RUNBOOK_SECRET_REF_UNKNOWN' })
  @ApiResponse({ status: 428, description: 'RUNBOOK_CONFIRMATION_REQUIRED: a destructive runbook needs `confirm: { runbookName, targetCount }`' })
  create(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Body() dto: CreateScheduleDto) {
    return this.schedules.create(principal, id, dto);
  }

  @Patch('runbooks/:id/schedules/:scheduleId')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE, PERMISSIONS.RUNBOOKS_RUN] })
  @ApiOperation({
    summary:
      'Change a schedule (requires runbooks:write and runbooks:run). Changing the targets, parameters, secrets, strategy or version makes it run as you and, for a destructive runbook, needs the confirmation and a new approval.',
  })
  @ApiResponse({ status: 200, description: 'The changed schedule' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_SCHEDULE_APPROVAL_REQUIRED: a destructive schedule cannot be enabled without an approval' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedules.update(principal, id, scheduleId, dto);
  }

  @Delete('runbooks/:id/schedules/:scheduleId')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE, PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a schedule; its past runs stay (requires runbooks:write and runbooks:run)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('scheduleId', ParseUUIDPipe) scheduleId: string, @CurrentPrincipal() principal: Principal): Promise<void> {
    await this.schedules.remove(principal, id, scheduleId);
  }

  @Post('runbooks/:id/schedules/:scheduleId/approve')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_APPROVE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a schedule of a destructive runbook version, which enables it (requires runbooks:approve)' })
  @ApiResponse({ status: 200, description: 'The approved schedule' })
  @ApiResponse({ status: 403, description: 'RUNBOOK_SCHEDULE_SELF_APPROVAL: the person it runs as may not approve it' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ApproveScheduleDto,
  ) {
    return this.schedules.approve(principal, id, scheduleId, dto);
  }

  @Post('runbooks/:id/schedules/:scheduleId/run-now')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run a schedule now, as you, without moving its next slot (requires runbooks:run)' })
  @ApiResponse({ status: 202, description: '`{ runId, status: "queued", ... }` as for POST /api/runbooks/{id}/runs' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_SCHEDULE_OVERLAP (previous run active, overlap skip) or RUNBOOK_SCHEDULE_APPROVAL_REQUIRED' })
  runNow(@Param('id', ParseUUIDPipe) id: string, @Param('scheduleId', ParseUUIDPipe) scheduleId: string, @CurrentPrincipal() principal: Principal) {
    return this.schedules.runNow(principal, id, scheduleId);
  }
}
