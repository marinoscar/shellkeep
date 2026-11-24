import { Controller, Get, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RawResponse, type Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';
import { createZodDto } from 'nestjs-zod';
import { Readable } from 'node:stream';
import { z } from 'zod';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { RunbookAuditService } from './runbook-audit.service';

const pageShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
};
/** An ISO 8601 date or date-time. */
const instant = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Not a valid date or date-time' });

export class AuditQueryDto extends createZodDto(z.object(pageShape)) {}
export class AuditExportQueryDto extends createZodDto(z.object({ format: z.enum(['csv', 'json']).default('csv') })) {}
export class CommandsQueryDto extends createZodDto(
  z.object({
    serverId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    from: instant.optional(),
    to: instant.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }),
) {}

/**
 * The audit trail of runbook runs (#67): per run (`/api/runbook-runs/:id/audit`, with a streamed CSV or JSON
 * export) and org-wide (`/api/runbook-commands`). Read-only. Every command row carries a redacted preview and
 * the sha256 of the exact command, never its output.
 */
@ApiTags('Runbooks')
@Controller()
export class RunbookAuditController {
  constructor(private readonly audit: RunbookAuditService) {}

  @Get('runbook-runs/:id/audit')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({
    summary:
      'The chronological audit trail of one run: lifecycle events and every executed command (server, user, approver, origin, redacted preview, sha256, exit code, timings, outcome) (requires runbooks:read)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ items, total, events, commands, page, pageSize }`; each item has `kind: "event" | "command"`' })
  @ApiResponse({ status: 404, description: 'Run not found (or not visible to the caller)' })
  trail(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Query() query: AuditQueryDto) {
    return this.audit.trail(principal, id, query);
  }

  /**
   * A file download, not a JSON resource: the body is the file, streamed in batches, so it is exempt from the
   * `{ data, meta }` envelope.
   */
  @Get('runbook-runs/:id/audit/export')
  @RawResponse()
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'Download the audit trail of one run as CSV (RFC 4180, formula-safe cells) or JSON, streamed (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiQuery({ name: 'format', enum: ['csv', 'json'], required: false })
  @ApiResponse({ status: 200, description: 'text/csv or application/json attachment' })
  @ApiResponse({ status: 404, description: 'Run not found (or not visible to the caller)' })
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Query() query: AuditExportQueryDto): Promise<StreamableFile> {
    // The access check runs before the first byte (a 404 is a normal response, not a broken download).
    await this.audit.assertVisible(principal, id);
    const stream = Readable.from(this.audit.exportChunks(principal, id, query.format), { objectMode: false });
    return new StreamableFile(stream, {
      type: query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      disposition: `attachment; filename="runbook-run-${id}-audit.${query.format}"`,
    });
  }

  @Get('runbook-commands')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({
    summary:
      'Every command runbooks executed across the organization, newest first: filter by serverId, userId (who started the run), runId, from, to. Only runs the caller may see (requires runbooks:read)',
  })
  @ApiResponse({ status: 200, description: 'Paginated command rows: `{ items, total, page, pageSize }`' })
  commands(@CurrentPrincipal() principal: Principal, @Query() query: CommandsQueryDto) {
    const { from, to, ...rest } = query;
    return this.audit.commands(principal, { ...rest, ...(from ? { from: new Date(from) } : {}), ...(to ? { to: new Date(to) } : {}) });
  }
}
