import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AI_SSE_HEADERS, AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';
import type { FastifyReply } from 'fastify';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { TerminalAssistDto } from './terminal-assist.dto';
import { TerminalAssistService, type AssistFrame } from './terminal-assist.service';

const frameText = (frame: AssistFrame): string => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`;

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
  @Auth({ permissions: [PERMISSIONS.AI_USE, PERMISSIONS.SESSIONS_WRITE] })
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
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const controller = new AbortController();
    const res = reply.raw;
    const onClose = () => {
      if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
    };
    res.on('close', onClose);

    let frames: AsyncIterable<AssistFrame>;
    try {
      // Eager: every pre-stream failure rejects here and the global filter answers it as JSON.
      frames = await this.assist.open({ userId, orgId }, dto, controller.signal);
    } catch (err) {
      res.off('close', onClose);
      throw err;
    }

    const inherited: Record<string, number | string | string[] | undefined> = { ...reply.getHeaders() };
    delete inherited['content-length'];
    delete inherited['content-type'];
    reply.hijack();
    res.writeHead(200, { ...inherited, ...AI_SSE_HEADERS });
    res.flushHeaders();
    try {
      for await (const frame of frames) {
        if (res.destroyed || controller.signal.aborted) break;
        res.write(frameText(frame));
      }
    } finally {
      res.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }
}
