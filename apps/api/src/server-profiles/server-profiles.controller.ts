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
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateServerProfileDto } from './dto/create-server-profile.dto';
import { UpdateServerProfileDto } from './dto/update-server-profile.dto';
import {
  SERVER_HEALTH,
  SERVER_HOST_KEY_STATES,
  SERVER_PROFILE_SORTS,
  ServerProfilesQueryDto,
} from './dto/server-profiles-query.dto';
import { BulkTagsDto } from './dto/bulk-tags.dto';
import { HostKeyError } from '../ssh/host-key.error';
import { hostKeyErrorToHttp } from '../ssh/host-key-http';
import { TrustHostKeyDto } from './dto/trust-host-key.dto';

@ApiTags('Server Profiles')
@Controller('server-profiles')
export class ServerProfilesController {
  constructor(private readonly serverProfilesService: ServerProfilesService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @ApiOperation({
    summary:
      'List the server profiles the caller may see: their own, those of their groups and those shared with them (requires servers:read)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, type: String, description: 'Text search over the name, hostname and username' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Older spelling of `q`' })
  @ApiQuery({ name: 'filter', required: false, enum: ['all', 'mine', 'shared'] })
  @ApiQuery({ name: 'owner', required: false, type: String, description: '`me`, `shared` or `group:<uuid>`' })
  @ApiQuery({ name: 'tag', required: false, type: [String], description: 'Repeatable: profiles carrying every tag' })
  @ApiQuery({ name: 'health', required: false, enum: SERVER_HEALTH })
  @ApiQuery({ name: 'hostKey', required: false, enum: SERVER_HOST_KEY_STATES })
  @ApiQuery({ name: 'sort', required: false, enum: SERVER_PROFILE_SORTS })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Paginated server profiles (never a credential field)' })
  async findAll(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ServerProfilesQueryDto,
  ) {
    return this.serverProfilesService.findAll(principal, query);
  }

  @Get('tags')
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @ApiOperation({ summary: 'The distinct tags on the server profiles the caller may see (requires servers:read)' })
  @ApiResponse({ status: 200, description: '`{ tags: string[] }`, sorted' })
  async listTags(@CurrentPrincipal() principal: Principal) {
    return this.serverProfilesService.listTags(principal);
  }

  @Patch('bulk-tags')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({
    summary:
      'Add and remove tags on up to 200 server profiles (requires servers:write plus write access on each; ids without it are reported, not failed)',
  })
  @ApiResponse({ status: 200, description: '`{ updated, unchanged, denied }`: the ids in each outcome' })
  @ApiResponse({ status: 400, description: 'More than 200 ids, no tag named, or a tag both added and removed' })
  async bulkTags(@CurrentPrincipal() principal: Principal, @Body() dto: BulkTagsDto) {
    return this.serverProfilesService.bulkTags(principal, dto);
  }

  @Get(':id')
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @ApiOperation({ summary: 'Get server profile by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Server profile details' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.serverProfilesService.findOne(id, principal);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Create a new server profile' })
  @ApiResponse({ status: 201, description: 'Server profile created' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateServerProfileDto,
  ) {
    return this.serverProfilesService.create(principal, dto);
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Update a server profile' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Server profile updated' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateServerProfileDto,
  ) {
    return this.serverProfilesService.update(id, principal, dto);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SERVERS_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a server profile' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Server profile deleted' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    await this.serverProfilesService.remove(id, principal);
  }

  @Post(':id/test')
  @Auth({ permissions: [PERMISSIONS.SERVERS_READ] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test SSH connection for a server profile; the outcome is stored (lastTestAt, lastTestOk)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.serverProfilesService.testConnection(id, principal);
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
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  @ApiResponse({ status: 502, description: 'SSH_HOST_UNREACHABLE: the server could not be reached' })
  async scanHostKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.serverProfilesService.scanHostKey(id, principal);
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
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  @ApiResponse({ status: 409, description: 'HOST_KEY_CHANGED_DURING_TRUST: the server presents another key than the one confirmed' })
  @ApiResponse({ status: 502, description: 'SSH_HOST_UNREACHABLE: the server could not be reached' })
  async trustHostKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: TrustHostKeyDto,
  ) {
    return this.serverProfilesService.trustHostKey(id, principal, dto);
  }

  @Delete(':id/host-key')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @ApiOperation({ summary: 'Forget the trusted host key; the next connection asks the user again' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated server profile' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  async forgetHostKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.serverProfilesService.forgetHostKey(id, principal);
  }

  @Post(':id/facts/refresh')
  @Auth({ permissions: [PERMISSIONS.SERVERS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe the server (OS, shell, package manager, tools) now' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '`{ facts, factsProbedAt }`' })
  @ApiResponse({ status: 404, description: 'Server profile not found, or not shared with the caller' })
  @ApiResponse({ status: 409, description: 'HOST_KEY_UNKNOWN or HOST_KEY_MISMATCH: the host key is not trusted' })
  async refreshFacts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    try {
      return await this.serverProfilesService.refreshFacts(id, principal);
    } catch (error) {
      if (error instanceof HostKeyError) throw hostKeyErrorToHttp(error, id);
      throw error;
    }
  }
}
