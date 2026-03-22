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

import { ServerProfilesService } from './server-profiles.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateServerProfileDto } from './dto/create-server-profile.dto';
import { UpdateServerProfileDto } from './dto/update-server-profile.dto';
import { ServerProfilesQueryDto } from './dto/server-profiles-query.dto';

@ApiTags('Server Profiles')
@Controller('server-profiles')
export class ServerProfilesController {
  constructor(private readonly serverProfilesService: ServerProfilesService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @ApiOperation({ summary: 'List server profiles for current user' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated server profiles' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: ServerProfilesQueryDto,
  ) {
    return this.serverProfilesService.findAll(userId, query);
  }

  @Get(':id')
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @ApiOperation({ summary: 'Get server profile by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Server profile details' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.serverProfilesService.findOne(id, userId);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Create a new server profile' })
  @ApiResponse({ status: 201, description: 'Server profile created' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateServerProfileDto,
  ) {
    return this.serverProfilesService.create(userId, dto);
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Update a server profile' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Server profile updated' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateServerProfileDto,
  ) {
    return this.serverProfilesService.update(id, userId, dto);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SERVERS_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a server profile' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Server profile deleted' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.serverProfilesService.remove(id, userId);
  }

  @Post(':id/test')
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test SSH connection for a server profile' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.serverProfilesService.testConnection(id, userId);
  }
}
