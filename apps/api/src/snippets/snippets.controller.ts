import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { SNIPPET_READS_PER_MINUTE, SNIPPET_WRITES_PER_MINUTE } from './snippets.constants';
import { CreateSnippetDto, ListSnippetsQueryDto, OrderSnippetsDto, UpdateSnippetDto } from './snippets.dto';
import { SnippetsRateLimiter } from './snippets-rate-limiter';
import { SnippetsService } from './snippets.service';

const ACCESS =
  'Access is the terminal\'s: `sessions:write`. A snippet belongs to its creator alone; another user\'s snippet is a 404. ' +
  'The body is stored as typed, is never logged or sent to a model, and is inserted into the terminal by the key panel (never run).';

@ApiTags('Snippets')
@Controller('snippets')
export class SnippetsController {
  constructor(
    private readonly snippets: SnippetsService,
    private readonly limiter: SnippetsRateLimiter,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'List the caller\'s snippets',
    description: `${ACCESS} Ordered by position. \`query\` keeps the snippets whose title or body contains the text, or that carry it as a tag. Rate limited per user.`,
  })
  @ApiQuery({ name: 'query', required: false, type: String, description: 'Search text, at most 100 characters' })
  @ApiResponse({ status: 200, description: '`{ items: [{ id, title, body, tags, position, createdAt, updatedAt }] }`' })
  @ApiResponse({ status: 429, description: 'SNIPPETS_RATE_LIMITED' })
  list(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Query() query: ListSnippetsQueryDto) {
    this.limiter.hit(userId, 'read', SNIPPET_READS_PER_MINUTE);
    return this.snippets.list({ userId, orgId }, query.query);
  }

  // `PUT /snippets/order` is declared before the `:id` routes so the literal wins.
  @Put('order')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'Reorder the caller\'s snippets',
    description: `${ACCESS} \`ids\` are put first in the given order; snippets it does not name follow in their current order. Rate limited per user.`,
  })
  @ApiResponse({ status: 200, description: 'The list in its new order: `{ items }`' })
  @ApiResponse({ status: 400, description: 'SNIPPET_ORDER_INVALID (an id twice)' })
  @ApiResponse({ status: 404, description: 'An id is not one of the caller\'s snippets' })
  @ApiResponse({ status: 429, description: 'SNIPPETS_RATE_LIMITED' })
  reorder(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Body() body: OrderSnippetsDto) {
    this.limiter.hit(userId, 'write', SNIPPET_WRITES_PER_MINUTE);
    return this.snippets.reorder({ userId, orgId }, body.ids);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a snippet',
    description: `${ACCESS} Title 1 to 80 characters, body 1 to 4096 bytes of text, at most 8 tags of 24 characters, at most 200 snippets per user. The new snippet goes last. \`warning: "looks-like-secret"\` is returned when the body looks like a credential (a private key, \`password=\`, an AWS-style key, a long high-entropy token); the snippet is saved all the same.`,
  })
  @ApiResponse({ status: 201, description: 'The snippet, with `warning` (`"looks-like-secret"` or null)' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'SNIPPET_LIMIT_REACHED' })
  @ApiResponse({ status: 429, description: 'SNIPPETS_RATE_LIMITED' })
  create(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Body() body: CreateSnippetDto) {
    this.limiter.hit(userId, 'write', SNIPPET_WRITES_PER_MINUTE);
    return this.snippets.create({ userId, orgId }, body);
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @ApiOperation({
    summary: 'Update a snippet',
    description: `${ACCESS} Any of \`title\`, \`body\` and \`tags\`; at least one. The secret warning is returned as on create.`,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The snippet, with `warning`' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller\'s' })
  @ApiResponse({ status: 429, description: 'SNIPPETS_RATE_LIMITED' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Body() body: UpdateSnippetDto,
  ) {
    this.limiter.hit(userId, 'write', SNIPPET_WRITES_PER_MINUTE);
    return this.snippets.update({ userId, orgId }, id, body);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a snippet', description: `${ACCESS} The snippets after it move up.` })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller\'s' })
  @ApiResponse({ status: 429, description: 'SNIPPETS_RATE_LIMITED' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string, @CurrentOrg() orgId: string) {
    this.limiter.hit(userId, 'write', SNIPPET_WRITES_PER_MINUTE);
    await this.snippets.remove({ userId, orgId }, id);
  }
}
