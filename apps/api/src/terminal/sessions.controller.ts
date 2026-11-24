import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { SessionsService } from './sessions.service';
import { SessionHistoryService } from './session-history.service';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentOrg, CurrentPrincipal, CurrentUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { BatchTerminateSessionsDto } from './dto/batch-terminate-sessions.dto';

@ApiTags('Terminal Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly history: SessionHistoryService,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_READ] })
  @ApiOperation({ summary: 'List terminal sessions for current user' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated terminal sessions' })
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Query() query: SessionQueryDto,
  ) {
    return this.sessionsService.findAll({ userId, orgId }, query);
  }

  @Post('batch-terminate')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_DELETE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch terminate multiple sessions' })
  @ApiResponse({ status: 200, description: 'Sessions terminated' })
  async batchTerminate(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Body() dto: BatchTerminateSessionsDto,
  ) {
    return this.sessionsService.batchTerminate(dto.ids, { userId, orgId });
  }

  @Get(':id/history')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_READ] })
  @ApiOperation({ summary: 'Download full tmux scrollback history' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Terminal history as plain text file' })
  @ApiResponse({ status: 400, description: 'Session is terminated' })
  @ApiResponse({ status: 404, description: 'Session or tmux session not found' })
  async getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Res() res: FastifyReply,
  ) {
    // findOne does ownership check
    const session = await this.sessionsService.findOne(id, { userId, orgId });

    if (session.status === 'terminated') {
      throw new BadRequestException('Cannot download history for a terminated session');
    }

    // Raw wrapping, as the download always was (`joinWrapped: false`). Failures are already
    // HttpExceptions (404 tmux gone, 409 host key, 502 gateway): the capture service maps them.
    const output = await this.history.captureSession(session, { userId, orgId }, { joinWrapped: false });

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `${session.name}-${timestamp}.txt`;

    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(output);
  }

  @Get(':id')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_READ] })
  @ApiOperation({ summary: 'Get terminal session by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Terminal session details' })
  @ApiResponse({ status: 404, description: 'Terminal session not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
  ) {
    return this.sessionsService.findOne(id, { userId, orgId });
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({ summary: 'Create a new terminal session' })
  @ApiResponse({ status: 201, description: 'Terminal session created' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller as operator or better' })
  async create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateSessionDto) {
    return this.sessionsService.create(principal, dto);
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({ summary: 'Rename a terminal session' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Terminal session updated' })
  @ApiResponse({ status: 404, description: 'Terminal session not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessionsService.update(id, { userId, orgId }, dto);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Terminate a terminal session' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Terminal session terminated' })
  @ApiResponse({ status: 404, description: 'Terminal session not found' })
  async terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
  ) {
    await this.sessionsService.terminate(id, { userId, orgId });
  }
}
