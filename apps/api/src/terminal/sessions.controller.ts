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
  HttpException,
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
import { SshService } from './ssh.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { BatchTerminateSessionsDto } from './dto/batch-terminate-sessions.dto';
import { ServerProfilesService } from '../server-profiles/server-profiles.service';

@ApiTags('Terminal Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly sshService: SshService,
    private readonly serverProfilesService: ServerProfilesService,
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
    @Query() query: SessionQueryDto,
  ) {
    return this.sessionsService.findAll(userId, query);
  }

  @Post('batch-terminate')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_DELETE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch terminate multiple sessions' })
  @ApiResponse({ status: 200, description: 'Sessions terminated' })
  async batchTerminate(
    @CurrentUser('id') userId: string,
    @Body() dto: BatchTerminateSessionsDto,
  ) {
    return this.sessionsService.batchTerminate(dto.ids, userId);
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
    @Res() res: FastifyReply,
  ) {
    // findOne does ownership check
    const session = await this.sessionsService.findOne(id, userId);

    if (session.status === 'terminated') {
      throw new BadRequestException('Cannot download history for a terminated session');
    }

    const profile = await this.serverProfilesService.getDecryptedProfile(
      session.serverProfileId,
      userId,
    );

    try {
      const output = await this.sshService.execCommand(
        profile,
        `tmux capture-pane -p -S - -t ${session.tmuxSessionId}`,
      );

      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `${session.name}-${timestamp}.txt`;

      res.header('Content-Type', 'text/plain; charset=utf-8');
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('session not found') ||
        message.includes('no server running') ||
        message.includes("can't find")
      ) {
        throw new HttpException('Remote tmux session no longer exists', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to retrieve terminal history from remote server',
        HttpStatus.BAD_GATEWAY,
      );
    }
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
  ) {
    return this.sessionsService.findOne(id, userId);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({ summary: 'Create a new terminal session' })
  @ApiResponse({ status: 201, description: 'Terminal session created' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessionsService.create(userId, dto);
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
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessionsService.update(id, userId, dto);
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
  ) {
    await this.sessionsService.terminate(id, userId);
  }
}
