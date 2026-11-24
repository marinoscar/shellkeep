import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@marinoscar/platform-api/identity';
import type { FastifyReply } from 'fastify';

import { HostKeyError } from '../ssh/host-key.error';
import { hostKeyErrorToHttp } from '../ssh/host-key-http';
import { FilesService } from './files.service';

/** `filename*` only (RFC 5987), so no byte of the name can break out of the header. */
export function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

/**
 * DELIBERATELY PUBLIC: a browser's native download sends no Authorization header, so the
 * single-use token from `POST /api/server-profiles/:id/files/download-token` is the only
 * credential (user, server, path and size are bound to it). The connect rule is checked again
 * on redemption. Every invalid token is the same 404.
 */
@ApiTags('Server Files')
@Controller('files/download')
export class FilesDownloadController {
  constructor(private readonly files: FilesService) {}

  @Get(':token')
  @Public()
  @ApiOperation({
    summary: 'Stream a file by download token (public, single use)',
    description:
      'Deliberately public: the token is the credential. Streams SFTP to the response with Content-Length and Content-Disposition, never buffering the file. A client abort stops the SFTP stream.',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'The file bytes' })
  @ApiResponse({ status: 404, description: 'FILE_DOWNLOAD_NOT_FOUND: unknown, expired, used, or access revoked' })
  @ApiResponse({ status: 409, description: 'FILE_CHANGED: the size changed since the token was issued' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE' })
  @ApiResponse({ status: 429, description: 'FILES_RATE_LIMITED' })
  async download(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
    let download;
    try {
      download = await this.files.openDownload(token);
    } catch (error) {
      if (error instanceof HostKeyError) throw hostKeyErrorToHttp(error);
      throw error;
    }
    const { stream, size, close, filename, mime } = download;
    let sent = 0;
    stream.on('data', (chunk: Buffer) => (sent += chunk.length));
    // A client that goes away stops the SFTP stream; a file that ends short must not look complete.
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) stream.destroy();
      close();
    });
    stream.once('end', () => {
      if (sent !== size) reply.raw.destroy();
    });
    stream.on('error', () => reply.raw.destroy());
    reply
      .header('Content-Type', mime)
      .header('Content-Length', size)
      .header('Content-Disposition', contentDisposition(filename))
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    await reply.send(stream);
  }
}
