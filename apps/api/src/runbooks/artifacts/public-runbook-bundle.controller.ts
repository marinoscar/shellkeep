import { Controller, Get, NotFoundException, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@marinoscar/platform-api/identity';
import {
  CurrentLinkGrant,
  LinkGrantGuard,
  LinkGrantResource,
  LinkGrantsService,
  PublicLinkInterceptor,
  type ResolvedLinkGrant,
} from '@marinoscar/platform-api/sharing';

import { PublicRunbookBundleService } from './public-runbook-bundle.service';

/**
 * The public face of a run's bundle (#63). DELIBERATELY PUBLIC: the `X-Link-Token` header of a share link
 * (`LinkGrantGuard`, resource type `runbook_run`) is the only credential. Every invalid link (unknown,
 * malformed, revoked, expired, the wrong type) is the same 404, and the responses carry
 * `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The route never streams bytes: it answers
 * a presigned URL valid 15 minutes.
 */
@ApiTags('Runbooks')
@Controller('public/runbook-runs')
@UseGuards(LinkGrantGuard)
@UseInterceptors(PublicLinkInterceptor)
export class PublicRunbookBundleController {
  constructor(
    private readonly links: LinkGrantsService,
    private readonly bundles: PublicRunbookBundleService,
  ) {}

  @Get('bundle')
  @Public()
  @LinkGrantResource('runbook_run', { action: 'read' })
  @ApiHeader({ name: 'X-Link-Token', required: true, description: 'The link token from the share URL fragment (`/s#lnk_...`). Never sent in a path or a query.' })
  @ApiOperation({
    summary: 'The bundle of a shared run (public, by share link)',
    description:
      'Deliberately public: the `X-Link-Token` header is the only credential. Answers the run bundle metadata and a presigned download URL valid 15 minutes. An invalid link, or a run with no bundle, is the same 404.',
  })
  @ApiResponse({ status: 200, description: '`{ runbook, finishedAt, sizeBytes, url, urlExpiresAt }`' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  @ApiResponse({ status: 429, description: 'LINK_RESOLUTION_THROTTLED' })
  async bundle(@CurrentLinkGrant() link: ResolvedLinkGrant | undefined) {
    if (!link) throw new NotFoundException('Link not found');
    const found = await this.bundles.resolve(link, (fn) => this.links.withLinkScope(link, fn));
    if (!found) throw new NotFoundException('Link not found');
    return found;
  }
}
