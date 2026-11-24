import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { CommandHistoryQueryDto } from './command-history.dto';
import { CommandHistoryService } from './command-history.service';

@ApiTags('Terminal Sessions')
@Controller('sessions/:id/command-history')
export class CommandHistoryController {
  constructor(private readonly history: CommandHistoryService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: "Recent shell commands of a session's server, newest first, redacted",
    description:
      "Reads the tail (at most 256 KB) of the login user's shell history file over SFTP (`.bash_history`, `.zsh_history` or fish's history: the one written most recently). " +
      'Access is the terminal\'s: `sessions:write`, the caller\'s own session and the right to connect to its server (404 otherwise). ' +
      'Entries that hold a secret are masked (`[REDACTED:<kind>]`, `masked: true`) and entries that are entirely a secret are dropped (`dropped` counts them); `query` matches the redacted text. ' +
      'Deduplicated, at most 500. bash writes its history when a shell exits, so the commands of a running shell may be missing. Cached for 30 seconds per session; rate limited per user. ' +
      'Not the tmux scrollback download (`GET /api/sessions/{id}/history`).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ shell: "bash"|"zsh"|"fish"|null, entries: [{ command, masked }], truncated, dropped }`' })
  @ApiResponse({ status: 404, description: 'Session not found, not the caller\'s, or no right to connect' })
  @ApiResponse({ status: 409, description: 'Host key unknown or changed' })
  @ApiResponse({ status: 429, description: 'FILES_RATE_LIMITED' })
  @ApiResponse({ status: 502, description: 'SFTP_UNAVAILABLE (subsystem disabled) or SFTP_FAILED' })
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Query() query: CommandHistoryQueryDto,
  ) {
    return this.history.list(id, principal, query);
  }
}
