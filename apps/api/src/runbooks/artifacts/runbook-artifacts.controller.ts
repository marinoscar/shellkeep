import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { RunbookArtifactsService } from './runbook-artifacts.service';

/**
 * The artifacts of a run (#63): the log archives its `collect_logs` steps stored and the zip bundle.
 * A run the caller may not see is a 404. Downloads are presigned URLs (15 minutes), never bytes.
 */
@ApiTags('Runbooks')
@Controller('runbook-runs/:id/artifacts')
export class RunbookArtifactsController {
  constructor(private readonly artifacts: RunbookArtifactsService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'The artifacts of a run: per-server log archives and the bundle state (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      '`{ items: [{ id, kind: "target_archive", serverName, stepId, stepIndex, fileCount, sizeBytes, sha256, createdAt }], bundle: { status: "ready" | "building" | "none", artifactId, sizeBytes, createdAt } }`',
  })
  @ApiResponse({ status: 404, description: 'Run not found' })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.artifacts.list(principal, id);
  }

  @Post('bundle')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Build the zip bundle of a finished run (deduplicated); poll GET .../artifacts until `bundle.status` is `ready` (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 202, description: '`{ jobId, artifactId }`: `jobId` is the queued (or already queued) build; `artifactId` is set instead, with `jobId: null`, when the run already has a bundle' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_RUN_STATE: the run has not finished (or is a dry run)' })
  bundle(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.artifacts.requestBundle(principal, id);
  }

  @Get(':artifactId/download')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'A signed download URL of one artifact, valid 15 minutes; audited as runbook_artifact.downloaded (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'artifactId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ url, expiresAt }`' })
  @ApiResponse({ status: 404, description: 'Run or artifact not found' })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.artifacts.download(principal, id, artifactId);
  }
}
