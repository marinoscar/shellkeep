import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { RunbookAiStopService } from './runbook-ai-stop.service';

/**
 * The run-side controls of AI steps (#64). Deliberately not under `/api/ai/*`: it only STOPS AI work, so it
 * must keep working when AI is switched off (the platform's AI guard would refuse it).
 */
@ApiTags('Runbooks')
@Controller('runbook-runs')
export class RunbookAiController {
  constructor(private readonly stopService: RunbookAiStopService) {}

  @Post(':id/ai/stop')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_RUN] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Stop the AI steps of a run: a running agent ends with AI_STOPPED before its next command, and an AI step parked behind an approval fails at once (requires runbooks:run)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 202, description: '`{ id, stopRequested: true, stoppedSteps }`' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_RUN_STATE: the run already finished' })
  stop(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.stopService.stop(principal, id);
  }
}
