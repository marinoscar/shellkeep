import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Logger, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { OrgCredentialsService, type OrgCredentialInfo } from '@marinoscar/platform-api/credentials';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';

import { recordAudit } from '../common/audit/record-audit';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { SetRunbookSecretDto, runbookSecretNameSchema } from './dto/runbook.dto';
import { RUNBOOK_SECRET_PURPOSE } from './runbooks.credentials';

/** What the API shows of a secret: never the value. */
export interface RunbookSecretView {
  name: string;
  label: string | null;
  /** The masked tail of the value (`••••` plus at most the last four characters); `null` when none. */
  hint: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const viewOf = (info: OrgCredentialInfo): RunbookSecretView => ({
  name: info.name,
  label: info.label,
  hint: info.hint,
  updatedBy: info.updatedByUserId,
  createdAt: info.createdAt,
  updatedAt: info.updatedAt,
});

/**
 * Secret parameters of runbooks, in the organization credential store (purpose `runbook_secret`).
 * WRITE-ONLY: no route returns a value. A run references a secret by name (`secretRefs`); the
 * value is read server-side by the run engine only.
 */
@ApiTags('Runbooks')
@Controller('runbook-secrets')
export class RunbookSecretsController {
  private readonly logger = new Logger(RunbookSecretsController.name);

  constructor(
    private readonly credentials: OrgCredentialsService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @ApiOperation({ summary: 'List runbook secrets: name, hint, label, updatedAt, updatedBy; never a value (requires runbooks:write)' })
  @ApiResponse({ status: 200, description: 'The organization’s runbook secrets' })
  async list(@CurrentOrg() orgId: string): Promise<RunbookSecretView[]> {
    return (await this.credentials.list(orgId, RUNBOOK_SECRET_PURPOSE)).map(viewOf);
  }

  @Put(':name')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @ApiOperation({ summary: 'Create or replace a runbook secret; the value is write-only (requires runbooks:write)' })
  @ApiParam({ name: 'name', type: String, description: 'Lower-case letters, digits, "_" or "-", starting with a letter (max 64)' })
  @ApiResponse({ status: 200, description: 'The secret without its value' })
  async set(
    @Param('name') rawName: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Body() dto: SetRunbookSecretDto,
  ): Promise<RunbookSecretView> {
    const name = this.parseName(rawName);
    const info = await this.credentials.setSecret(orgId, RUNBOOK_SECRET_PURPOSE, name, dto.value, {
      ...(dto.label !== undefined ? { label: dto.label } : {}),
      updatedByUserId: userId,
    });
    await recordAudit(this.auditSink, this.logger, {
      action: 'runbook_secret.set',
      actorUserId: userId,
      targetType: 'runbook_secret',
      targetId: name,
      meta: { name },
    });
    return viewOf(info);
  }

  @Delete(':name')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a runbook secret; idempotent (requires runbooks:write)' })
  @ApiParam({ name: 'name', type: String })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(@Param('name') rawName: string, @CurrentUser('id') userId: string, @CurrentOrg() orgId: string): Promise<void> {
    const name = this.parseName(rawName);
    await this.credentials.deleteSecret(orgId, RUNBOOK_SECRET_PURPOSE, name);
    await recordAudit(this.auditSink, this.logger, {
      action: 'runbook_secret.deleted',
      actorUserId: userId,
      targetType: 'runbook_secret',
      targetId: name,
      meta: { name },
    });
  }

  private parseName(raw: string): string {
    const parsed = runbookSecretNameSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid secret name');
    return parsed.data;
  }
}
