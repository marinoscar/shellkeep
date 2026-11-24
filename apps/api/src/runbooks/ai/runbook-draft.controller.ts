import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { DraftRunbookDto } from './runbook-draft.dto';
import { RunbookDraftService } from './runbook-draft.service';

/**
 * `POST /api/ai/runbooks/draft`: a consumer route of the platform AI slice, so it sits behind
 * `AiEnabledGuard` and `AiOrgEnabledInterceptor` and declares `ai:use` like every route under `/api/ai/*`.
 * Saving the draft is the runbooks' own route (`POST /api/runbooks`).
 */
@ApiTags('Runbooks')
@Controller('ai/runbooks')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class RunbookDraftController {
  constructor(private readonly drafts: RunbookDraftService) {}

  @Post('draft')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Draft a runbook definition from a plain-language prompt. Never saved and never run: returns { definition, warnings, risk } (requires ai:use and runbooks:write)',
  })
  @ApiResponse({ status: 200, description: '`{ definition, warnings, risk }`: a definition valid under the runbook schema, with what to check first' })
  @ApiResponse({ status: 403, description: 'AI_DISABLED, or the caller lacks runbooks:write' })
  @ApiResponse({ status: 502, description: 'AI_STRUCTURED_OUTPUT_INVALID: the model did not produce a valid definition' })
  draft(@CurrentPrincipal() principal: Principal, @Body() dto: DraftRunbookDto) {
    return this.drafts.draft(principal, dto);
  }
}
