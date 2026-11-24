import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';
import type { FastifyReply } from 'fastify';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { streamFrames } from './terminal-ai.sse';
import { TERMINAL_EXPLAIN_BODY_SCHEMA, terminalExplainSchema, type TerminalExplainInput } from './terminal-explain.dto';
import { TerminalExplainService, type ExplainPreview } from './terminal-explain.service';

const requireSessionsRead = (permissions: readonly string[] | undefined): void => {
  if (!permissions?.includes(PERMISSIONS.SESSIONS_READ)) {
    throw new ForbiddenException('Explaining terminal output needs permission to read sessions');
  }
};

/**
 * Explain a selection or the last error (issue #58). Under `/api/ai/*`: AI kill switch,
 * organization AI switch, `ai:use`, plus `sessions:read` checked in the handler (the
 * `ai-rbac-matrix` suite allows only AI permission strings in a route declaration).
 */
@ApiTags('AI')
@Controller('ai/terminal/explain')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class TerminalExplainController {
  constructor(private readonly explain: TerminalExplainService) {}

  @Post()
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Explain a selection or the last error in a terminal session',
    description:
      'Streams `context` (`findings`, `lines`, `truncated`), `delta` (raw markdown tokens), then `result` ' +
      '(`markdown` and an optional `suggestedCommand` with `risk`, `destructive` and `reasons` computed by the ' +
      'server) or `error` (`code`). The suggestion is text only: it is never executed. Failures before the first ' +
      'event are plain JSON errors: 404 (not your session), 403 `AI_DISABLED`, 409 `AI_CONSENT_REQUIRED`, ' +
      '409 `AI_OUTPUT_SHARING_DISABLED`, 429 `AI_RATE_LIMITED`.',
  })
  @ApiBody({ schema: TERMINAL_EXPLAIN_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: 'An event stream that ends after `result` or `error`.' })
  @ApiResponse({ status: 404, description: 'The session does not exist or is not yours' })
  @ApiResponse({ status: 409, description: '`AI_CONSENT_REQUIRED` or `AI_OUTPUT_SHARING_DISABLED`' })
  @ApiResponse({ status: 429, description: '`AI_RATE_LIMITED`; `Retry-After` says when to retry' })
  async stream(
    @Body(new ZodValidationPipe(terminalExplainSchema)) dto: TerminalExplainInput,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser('permissions') permissions: readonly string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    requireSessionsRead(permissions);
    await streamFrames(reply, (signal) => this.explain.open({ userId, orgId }, dto, signal));
  }

  @Post('preview')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview the redacted text an explain request would send',
    description:
      'A dry run of `POST /api/ai/terminal/explain`: the same checks and redaction, the exact text and the ' +
      'redaction findings, and NO model call.',
  })
  @ApiBody({ schema: TERMINAL_EXPLAIN_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: '`{ data: { text, findings, truncated } }`' })
  @ApiResponse({ status: 404, description: 'The session does not exist or is not yours' })
  @ApiResponse({ status: 409, description: '`AI_CONSENT_REQUIRED` or `AI_OUTPUT_SHARING_DISABLED`' })
  async preview(
    @Body(new ZodValidationPipe(terminalExplainSchema)) dto: TerminalExplainInput,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser('permissions') permissions: readonly string[] | undefined,
  ): Promise<ExplainPreview> {
    requireSessionsRead(permissions);
    return this.explain.preview({ userId, orgId }, dto);
  }
}
