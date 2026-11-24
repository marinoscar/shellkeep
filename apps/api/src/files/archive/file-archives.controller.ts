import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { HostKeyError } from '../../ssh/host-key.error';
import { hostKeyErrorToHttp } from '../../ssh/host-key-http';
import { FileArchivesService } from './file-archives.service';

const ACCESS =
  'Access is the terminal\'s: `sessions:write` plus the right to connect to the server (owner, or a share that allows connecting).';

class ArchiveBodyDto extends createZodDto(z.object({ path: z.string().min(1).max(4096), sessionId: z.string().uuid().optional() })) {}

@ApiTags('Server Profiles')
@Controller()
export class FileArchivesController {
  constructor(private readonly archives: FileArchivesService) {}

  @Post('server-profiles/:id/files/archive')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Archive a folder of the server as a tar.gz (queue job)',
    description:
      `${ACCESS} The path must be a directory (checked over SFTP). A \`files.archive\` job tars it over SSH and streams the tar.gz into object storage, capped by \`files.downloadMaxBytes\`; poll \`GET /api/files/archives/{archiveId}\`. The archive is deleted 24 hours after it was requested. Rate limited per user.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 202, description: '`{ archiveId, jobId, status: "pending" }`' })
  @ApiResponse({ status: 400, description: 'FILE_NOT_A_DIRECTORY or FILE_PATH_INVALID' })
  @ApiResponse({ status: 404, description: 'Server, session or path not found, or no right to connect' })
  @ApiResponse({ status: 429, description: 'FILES_RATE_LIMITED (too many requests, or too many archives being built)' })
  async request(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Body() body: ArchiveBodyDto) {
    try {
      return await this.archives.request(id, principal, body);
    } catch (error) {
      if (error instanceof HostKeyError) throw hostKeyErrorToHttp(error, id);
      throw error;
    }
  }

  @Get('files/archives/:archiveId')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'The status of a folder archive',
    description: `${ACCESS} Only the requester sees an archive; anything else is a 404. \`status\` is pending, running, ready, failed or expired.`,
  })
  @ApiParam({ name: 'archiveId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ archiveId, serverProfileId, path, status, sizeBytes, warning, errorCode, errorMessage, createdAt, finishedAt, expiresAt }`' })
  @ApiResponse({ status: 404, description: 'Not found, not yours, or no right to connect to the server' })
  get(@Param('archiveId', ParseUUIDPipe) archiveId: string, @CurrentPrincipal() principal: Principal) {
    return this.archives.get(principal, archiveId);
  }

  @Get('files/archives/:archiveId/download')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'A signed link to download a ready archive',
    description: `${ACCESS} Answers a presigned URL valid for 15 minutes with \`Content-Disposition: attachment\`. Audited.`,
  })
  @ApiParam({ name: 'archiveId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ url, filename, expiresAt }`' })
  @ApiResponse({ status: 404, description: 'Not found, not yours, expired, or no right to connect to the server' })
  @ApiResponse({ status: 409, description: 'FILE_ARCHIVE_NOT_READY (still building, or failed)' })
  download(@Param('archiveId', ParseUUIDPipe) archiveId: string, @CurrentPrincipal() principal: Principal) {
    return this.archives.download(principal, archiveId);
  }
}
