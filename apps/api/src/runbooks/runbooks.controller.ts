import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';
import type { FastifyReply } from 'fastify';

import { PERMISSIONS } from '../common/constants/roles.constants';
import {
  CreateRunbookDto,
  PreviewTargetsDto,
  ReplaceDefinitionDto,
  RunbooksQueryDto,
  UpdateRunbookMetadataDto,
  ValidateDefinitionDto,
  VersionsQueryDto,
} from './dto/runbook.dto';
import { RUNBOOK_ERROR_CODES } from './runbooks.error-codes';
import { RunbooksService, parseVersionEtag, versionEtag } from './runbooks.service';
import { TargetResolverService } from './target-resolver.service';

/**
 * `/api/runbooks`. Static paths (`validate`, `targets/preview`) are declared before the
 * `:id` routes so they are never read as an id.
 */
@ApiTags('Runbooks')
@Controller('runbooks')
export class RunbooksController {
  constructor(
    private readonly runbooks: RunbooksService,
    private readonly targets: TargetResolverService,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({
    summary:
      'List the runbooks the caller may see: their own, those of their groups and those shared with them (requires runbooks:read)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated runbooks with their latest version summary, the owner (`user` or `group`) and `access` (`role`, `via`, `shared`, `can`); `filter` is `all`, `mine` or `shared`',
  })
  list(@CurrentPrincipal() principal: Principal, @Query() query: RunbooksQueryDto) {
    return this.runbooks.list(principal, query);
  }

  @Post('validate')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a definition without saving it (requires runbooks:write)' })
  @ApiResponse({ status: 200, description: 'The normalised definition, its sha256 and warnings' })
  @ApiResponse({ status: 422, description: 'RUNBOOK_DEFINITION_INVALID, with `details.issues` (path, code, message)' })
  validate(@Body() dto: ValidateDefinitionDto) {
    return this.runbooks.validate(dto.definition);
  }

  @Post('targets/preview')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview the servers a target selector resolves to (requires runbooks:read)' })
  @ApiResponse({
    status: 200,
    description:
      '`{ servers: [{ id, name, hostname, tags, hostKeyTrusted, facts: { prettyName } }], skipped: [{ serverProfileId, reason }], total, capped, limit }`',
  })
  @ApiResponse({ status: 422, description: 'RUNBOOK_TARGET_GROUPS_UNAVAILABLE: `groupIds` are not supported yet' })
  async previewTargets(@CurrentPrincipal() principal: Principal, @Body() dto: PreviewTargetsDto) {
    const { targets, ...rest } = await this.targets.resolve(principal, dto.selector);
    return { servers: targets, ...rest };
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @ApiOperation({ summary: 'Create a runbook with its first version (requires runbooks:write)' })
  @ApiResponse({ status: 201, description: 'The runbook with version 1 embedded; `ETag: "v1"`' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_NAME_TAKEN' })
  @ApiResponse({ status: 422, description: 'RUNBOOK_DEFINITION_INVALID' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateRunbookDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const runbook = await this.runbooks.create(principal, dto);
    this.setEtag(reply, runbook.latestVersion?.version);
    return runbook;
  }

  @Get(':id')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'Get a runbook with its latest version (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The runbook; `ETag: "v<version>"`' })
  @ApiResponse({ status: 404, description: 'Runbook not found, or not shared with the caller' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const runbook = await this.runbooks.findOne(principal, id);
    this.setEtag(reply, runbook.latestVersion?.version);
    return runbook;
  }

  @Put(':id/definition')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @ApiOperation({ summary: 'Replace the definition: creates the next version (requires runbooks:write)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'The version being replaced, as `"v<n>"` (the ETag of a GET)' })
  @ApiResponse({ status: 200, description: 'The runbook and `created` (false when the definition is identical to the latest version); new `ETag`' })
  @ApiResponse({ status: 412, description: 'Stale If-Match: the runbook has a newer version' })
  @ApiResponse({ status: 422, description: 'RUNBOOK_DEFINITION_INVALID' })
  @ApiResponse({ status: 428, description: 'RUNBOOK_IF_MATCH_REQUIRED' })
  async replaceDefinition(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: ReplaceDefinitionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (ifMatch === undefined || ifMatch.trim() === '') {
      throw new HttpException(
        { code: RUNBOOK_ERROR_CODES.IF_MATCH_REQUIRED, message: 'Send If-Match with the version you are replacing, for example "v3"' },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    const expected = parseVersionEtag(ifMatch);
    if (expected === null) {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'If-Match must look like "v3"' }, HttpStatus.BAD_REQUEST);
    }
    const { runbook, created } = await this.runbooks.replaceDefinition(principal, id, expected, dto);
    this.setEtag(reply, runbook.latestVersion?.version);
    return { ...runbook, created };
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @ApiOperation({ summary: 'Update name, description or tags; the definition is untouched (requires runbooks:write)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated runbook' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_NAME_TAKEN or RUNBOOK_ARCHIVED' })
  updateMetadata(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateRunbookMetadataDto,
  ) {
    return this.runbooks.updateMetadata(principal, id, dto);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a runbook (soft delete; requires runbooks:write)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Archived' })
  async archive(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    await this.runbooks.archive(principal, id);
  }

  @Delete(':id/permanent')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Permanently delete a runbook with its versions, runs and grants (requires runbooks:write and the owner role: the creator or an admin of the owning group)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found, or the caller is not its owner' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_HAS_ACTIVE_RUNS' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    await this.runbooks.remove(principal, id);
  }

  @Post(':id/restore')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived runbook (requires runbooks:write)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The restored runbook' })
  @ApiResponse({ status: 409, description: 'RUNBOOK_NAME_TAKEN: a live runbook has this name now' })
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: Principal) {
    return this.runbooks.restore(principal, id);
  }

  @Get(':id/versions')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'Version history, newest first (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated version summaries (no definitions)' })
  listVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @Query() query: VersionsQueryDto,
  ) {
    return this.runbooks.listVersions(principal, id, query);
  }

  @Get(':id/versions/:version')
  @Auth({ permissions: [PERMISSIONS.RUNBOOKS_READ] })
  @ApiOperation({ summary: 'One version with its definition (requires runbooks:read)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'version', type: Number })
  @ApiResponse({ status: 200, description: 'The version' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.runbooks.getVersion(principal, id, version);
  }

  private setEtag(reply: FastifyReply, version: number | undefined): void {
    if (version !== undefined) reply.header('ETag', versionEtag(version));
  }
}
