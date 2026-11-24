import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';
import type { FastifyReply } from 'fastify';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { TerminalAssistDto } from './terminal-assist.dto';
import { streamFrames } from './terminal-ai.sse';
import { TerminalAssistService } from './terminal-assist.service';

/**
 * Terminal command assist (issue #57). Sits under `/api/ai/*`: AI kill switch, organization AI
 * switch, `ai:use`, plus `sessions:write` (the caller must be able to type in the session).
 */
@ApiTags('AI')
@Controller('ai/terminal')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class TerminalAssistController {
  constructor(private readonly assist: TerminalAssistService) {}

  @Post('assist')
  // The `ai-rbac-matrix` suite allows only the AI permission strings in a route's declaration, so
  // `sessions:write` (the caller may type in the session) is checked in the handler below.
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Suggest one shell command for a terminal session',
    description:
      'Streams `context` (what was sent: os, shell, cwd, redacted screen line count and redaction findings), ' +
      '`delta` (raw tokens), then `result` (`command`, `explanation`, and `risk`, `destructive`, `reasons` ' +
      'computed by the server, never by the model) or `error` (`code`, e.g. `AI_ASSIST_UNPARSEABLE`). ' +
      'The command is a suggestion only: it is never executed. Failures before the first event (404 for a ' +
      'session that is not yours, 403 `AI_DISABLED`, 409 `AI_CONSENT_REQUIRED`, 429 with `Retry-After`) are plain JSON errors.',
  })
  @ApiBody({ type: TerminalAssistDto })
  @ApiResponse({ status: 200, description: 'An event stream that ends after `result` or `error`.' })
  @ApiResponse({ status: 404, description: 'The session does not exist or is not yours' })
  @ApiResponse({ status: 409, description: '`AI_CONSENT_REQUIRED`' })
  @ApiResponse({ status: 429, description: '`AI_RATE_LIMITED`; `Retry-After` says when to retry' })
  async stream(
    @Body() dto: TerminalAssistDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser('permissions') permissions: readonly string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!permissions?.includes(PERMISSIONS.SESSIONS_WRITE)) {
      throw new ForbiddenException('Terminal assist needs permission to write to sessions');
    }
    await streamFrames(reply, (signal) => this.assist.open({ userId, orgId }, dto, signal));
  }
}
