import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Inject, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';
import { UserSettingsService } from '@marinoscar/platform-api/settings';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { recordAudit } from '../common/audit/record-audit';
import { TerminalContextService } from './terminal-context.service';

/**
 * Terminal AI consent (issue #56). Sits under `/api/ai/*`, so it carries the platform's AI
 * kill switch and `ai:use` like every consumer route there.
 */
@ApiTags('AI')
@Controller('ai/terminal')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class TerminalAiConsentController {
  private readonly logger = new Logger(TerminalAiConsentController.name);

  constructor(
    private readonly context: TerminalContextService,
    private readonly userSettings: UserSettingsService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  @Get('consent')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @ApiOperation({ summary: 'Whether terminal AI consent is required and whether the user gave it' })
  @ApiResponse({ status: 200, description: 'The consent state and the effective redaction mode' })
  async status(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string) {
    const policy = await this.context.policy({ userId, orgId });
    return {
      required: policy.requireConsent,
      consentAcceptedAt: policy.consentAcceptedAt,
      redactionMode: policy.redactionMode,
    };
  }

  @Post('consent')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the terminal AI notice',
    description:
      'Records that the caller accepts that redacted terminal output may be sent to AI. Redaction is best effort; a server profile can switch sharing off entirely.',
  })
  @ApiResponse({ status: 200, description: 'Consent recorded; `consentAcceptedAt` is the timestamp' })
  async accept(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Body() _body: unknown) {
    const consentAcceptedAt = new Date().toISOString();
    // `terminalAi` is an app namespace: the platform's static body type lists only its own.
    await this.userSettings.patchSettings(userId, {
      terminalAi: { consentAcceptedAt },
    } as unknown as Parameters<UserSettingsService['patchSettings']>[1]);
    await recordAudit(this.auditSink, this.logger, {
      action: 'terminal_ai.consent',
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      meta: { orgId },
    });
    return { consentAcceptedAt };
  }
}
