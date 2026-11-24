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
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateServerProfileDto } from './dto/create-server-profile.dto';
import { UpdateServerProfileDto } from './dto/update-server-profile.dto';
import { ServerProfilesQueryDto } from './dto/server-profiles-query.dto';
import { HostKeyError } from '../ssh/host-key.error';
import { hostKeyErrorToHttp } from '../ssh/host-key-http';
import { TrustHostKeyDto } from './dto/trust-host-key.dto';

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
    @CurrentOrg() orgId: string,
    @Query() query: ServerProfilesQueryDto,
  ) {
    return this.serverProfilesService.findAll({ userId, orgId }, query);
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
    @CurrentOrg() orgId: string,
  ) {
    return this.serverProfilesService.findOne(id, { userId, orgId });
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Create a new server profile' })
  @ApiResponse({ status: 201, description: 'Server profile created' })
  async create(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Body() dto: CreateServerProfileDto,
  ) {
    return this.serverProfilesService.create({ userId, orgId }, dto);
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
    @CurrentOrg() orgId: string,
    @Body() dto: UpdateServerProfileDto,
  ) {
    return this.serverProfilesService.update(id, { userId, orgId }, dto);
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
    @CurrentOrg() orgId: string,
  ) {
    await this.serverProfilesService.remove(id, { userId, orgId });
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
    @CurrentOrg() orgId: string,
  ) {
    return this.serverProfilesService.testConnection(id, { userId, orgId });
  }

  @Post(':id/host-key/scan')
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read the host key a server presents (no credential is sent) and compare it with the trusted one',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: '`{ presented: { fingerprint, algorithm }, trusted: { fingerprint, algorithm, trustedAt } | null, matches }`',
  })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  @ApiResponse({ status: 502, description: 'SSH_HOST_UNREACHABLE: the server could not be reached' })
  async scanHostKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
  ) {
    return this.serverProfilesService.scanHostKey(id, { userId, orgId });
  }

  @Post(':id/host-key/trust')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trust the host key the server presents now (replacing a different one needs confirmHostname)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated server profile' })
  @ApiResponse({ status: 400, description: 'HOST_KEY_CONFIRMATION_REQUIRED: replacing a trusted key without confirmHostname' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  @ApiResponse({ status: 409, description: 'HOST_KEY_CHANGED_DURING_TRUST: the server presents another key than the one confirmed' })
  @ApiResponse({ status: 502, description: 'SSH_HOST_UNREACHABLE: the server could not be reached' })
  async trustHostKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Body() dto: TrustHostKeyDto,
  ) {
    return this.serverProfilesService.trustHostKey(id, { userId, orgId }, dto);
  }

  @Delete(':id/host-key')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Forget the trusted host key; the next connection asks the user again' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated server profile' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  async forgetHostKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
  ) {
    return this.serverProfilesService.forgetHostKey(id, { userId, orgId });
  }

  @Post(':id/facts/refresh')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe the server (OS, shell, package manager, tools) now' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ facts, factsProbedAt }`' })
  @ApiResponse({ status: 404, description: 'Server profile not found' })
  @ApiResponse({ status: 409, description: 'HOST_KEY_UNKNOWN or HOST_KEY_MISMATCH: the host key is not trusted' })
  async refreshFacts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
  ) {
    try {
      return await this.serverProfilesService.refreshFacts(id, { userId, orgId });
    } catch (error) {
      if (error instanceof HostKeyError) throw hostKeyErrorToHttp(error, id);
      throw error;
    }
  }
}
