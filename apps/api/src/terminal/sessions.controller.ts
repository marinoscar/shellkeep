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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { SessionsService } from './sessions.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';

@ApiTags('Terminal Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

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
