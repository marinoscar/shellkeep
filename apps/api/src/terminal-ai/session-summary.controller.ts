import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { SessionSummaryItemParamsDto, SessionSummaryParamsDto } from './session-summary.dto';
import { SessionSummaryService } from './session-summary.service';

const requireSessionsRead = (permissions: readonly string[] | undefined): void => {
  // The `ai-rbac-matrix` suite allows only the AI permission strings in a route's declaration, so
  // `sessions:read` (the caller may see the session) is checked here.
  if (!permissions?.includes(PERMISSIONS.SESSIONS_READ)) {
    throw new ForbiddenException('Session summaries need permission to read sessions');
  }
};

/**
 * Terminal session summaries (issue #59). Sits under `/api/ai/*`: AI kill switch, organization AI
 * switch and `ai:use`, plus `sessions:read`. Writing a summary is a background job
 * (`ai.session.summarize`); these routes only queue it and read the result.
 */
@ApiTags('AI')
@Controller('ai/terminal/sessions/:id/summaries')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class SessionSummaryController {
  constructor(private readonly summaries: SessionSummaryService) {}

  @Post()
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Summarize a terminal session in the background',
    description:
      'Queues an `ai.session.summarize` job and answers `202 { summaryId, jobId, status }`. Poll the summary ' +
      'until its status is `succeeded` or `failed`. While a summary of the session is pending, another request ' +
      'answers with that one. The session text is redacted before it reaches a model and the summary is stored redacted.',
  })
  @ApiResponse({ status: 202, description: 'Queued, or the summary already pending' })
  @ApiResponse({ status: 400, description: '`SESSION_TERMINATED`: the session has ended' })
  @ApiResponse({ status: 404, description: 'The session does not exist or is not yours' })
  @ApiResponse({ status: 409, description: '`AI_CONSENT_REQUIRED` or `AI_OUTPUT_SHARING_DISABLED`' })
  request(
    @Param() params: SessionSummaryParamsDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser('permissions') permissions: readonly string[] | undefined,
  ) {
    requireSessionsRead(permissions);
    return this.summaries.request({ userId, orgId }, params.id);
  }

  @Get()
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @ApiOperation({ summary: 'List the newest summaries of a terminal session (at most 20)' })
  @ApiResponse({ status: 200, description: 'The summaries, newest first' })
  @ApiResponse({ status: 404, description: 'The session does not exist or is not yours' })
  list(
    @Param() params: SessionSummaryParamsDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser('permissions') permissions: readonly string[] | undefined,
  ) {
    requireSessionsRead(permissions);
    return this.summaries.list({ userId, orgId }, params.id);
  }

  @Get(':summaryId')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @ApiOperation({ summary: 'Get one summary of a terminal session' })
  @ApiResponse({ status: 200, description: 'The summary, `pending` until the job settles it' })
  @ApiResponse({ status: 404, description: 'The session or summary does not exist or is not yours' })
  get(
    @Param() params: SessionSummaryItemParamsDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser('permissions') permissions: readonly string[] | undefined,
  ) {
    requireSessionsRead(permissions);
    return this.summaries.get({ userId, orgId }, params.id, params.summaryId);
  }
}
