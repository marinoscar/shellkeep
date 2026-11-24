import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { HostKeyError } from '../ssh/host-key.error';
import { hostKeyErrorToHttp } from '../ssh/host-key-http';
import { DownloadTokenBodyDto, FilesContentQueryDto, FilesPathQueryDto, FilesStatQueryDto, UploadQueryDto } from './dto/files.dto';
import { FilesService } from './files.service';

const ACCESS =
  'Access is the terminal\'s: `sessions:write` plus the right to connect to the server (owner, or a share that allows connecting).';

/** Runs a files call; a refused host key is the 409 the rest of the SSH routes answer. */
async function guarded<T>(profileId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HostKeyError) throw hostKeyErrorToHttp(error, profileId);
    throw error;
  }
}

@ApiTags('Server Profiles')
@Controller('server-profiles/:id/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'List a directory on the server over SFTP',
    description: `${ACCESS} Directories first, then by name. \`sessionId\` resolves relative paths and \`~\` against that session's working directory and home.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ path, entries: [{ name, type, size, mtime, mode, symlinkTarget, targetType }], truncated }`' })
  @ApiResponse({ status: 404, description: 'Server, session or path not found, or no right to connect' })
  @ApiResponse({ status: 502, description: 'SFTP_UNAVAILABLE (subsystem disabled) or SFTP_FAILED' })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Query() query: FilesPathQueryDto) {
    return guarded(id, () => this.files.list(id, principal, query));
  }

  @Get('stat')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({ summary: 'Describe one path on the server: the list fields plus `mime` and `isText`', description: ACCESS })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The entry, its absolute `path`, `mime` (from the extension) and `isText` (from the first 8 KB)' })
  @ApiResponse({ status: 404, description: 'Server, session or path not found, or no right to connect' })
  stat(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Query() query: FilesStatQueryDto) {
    return guarded(id, () => this.files.stat(id, principal, query));
  }

  @Get('content')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'Read a window of a text file as UTF-8',
    description: `${ACCESS} \`length\` is capped at the full-view limit and files above the paged limit are refused (FILE_TOO_LARGE). A binary file (NUL byte or invalid UTF-8 in its first 8 KB) answers FILE_IS_BINARY. A window never splits a character: continue at \`offset + length\`. Rate limited per user.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ text, offset, length, size, eof }`' })
  @ApiResponse({ status: 404, description: 'Server, session or path not found, or no right to connect' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 415, description: 'FILE_IS_BINARY' })
  @ApiResponse({ status: 429, description: 'FILES_RATE_LIMITED' })
  content(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Query() query: FilesContentQueryDto) {
    return guarded(id, () => this.files.content(id, principal, query));
  }

  @Post('download-token')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue a single-use, 60 second token to download one file',
    description: `${ACCESS} The token is bound to the user, server, path and size. Redeem it with \`GET /api/files/download/{token}\`. Refused above the download limit. Rate limited per user.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ token, expiresAt }`' })
  @ApiResponse({ status: 404, description: 'Server, session or path not found, or no right to connect' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 429, description: 'FILES_RATE_LIMITED' })
  downloadToken(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal, @Body() body: DownloadTokenBodyDto) {
    return guarded(id, () => this.files.issueDownloadToken(id, principal, body));
  }

  @Post('upload')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'Upload one file into a folder on the server, streamed over SFTP',
    description:
      `${ACCESS} The body is the file's raw bytes (\`Content-Type: application/octet-stream\`), never buffered: it streams to a ` +
      'temporary name in the target folder and is renamed onto `name` when complete. `path` is the target folder, `name` one file name ' +
      '(no `/`, NUL, control characters, `.` or `..`; at most 200 bytes). The size is capped by `files.uploadMaxBytes` (the Content-Length ' +
      'is checked up front and the bytes are counted while streaming; an overflow removes the temp file). An existing target is a ' +
      '409 FILE_EXISTS (with its size and mtime) unless `overwrite=true`. A client abort or error removes the temp file. Rate limited per user ' +
      '(the download budget and concurrency).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ description: 'The raw file bytes', schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 201, description: '`{ path, name, size, overwritten }`' })
  @ApiResponse({ status: 400, description: 'FILE_NAME_INVALID, FILE_NOT_A_DIRECTORY, FILE_NOT_A_FILE (a folder has that name)' })
  @ApiResponse({ status: 404, description: 'Server, session or folder not found, or no right to connect' })
  @ApiResponse({ status: 409, description: 'FILE_EXISTS (`details` carry the existing size and mtime)' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 415, description: 'The body is not application/octet-stream' })
  @ApiResponse({ status: 429, description: 'FILES_RATE_LIMITED' })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Query() query: UploadQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const declared = req.headers['content-length'];
    const contentLength = declared !== undefined && /^\d+$/.test(declared) ? Number(declared) : null;
    return guarded(id, () =>
      this.files.upload(id, principal, {
        path: query.path,
        name: query.name,
        overwrite: query.overwrite,
        sessionId: query.sessionId,
        contentType: req.headers['content-type'],
        contentLength,
        body: req.raw as Readable,
      }),
    );
  }
}
