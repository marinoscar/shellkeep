import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { DashboardSummaryDto, type DashboardSummary } from './dashboard.schema';
import { DashboardService } from './dashboard.service';

/** `/api/dashboard`: the Home page's one read (issue #78). Read-only. */
@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @Auth({ permissions: [PERMISSIONS.SESSIONS_READ] })
  @ApiOperation({
    summary: 'Fleet health, active sessions and recent runs for the Home page (requires sessions:read)',
    description:
      'Counts plus the five most recent rows, over what the caller may see: server profiles they own, a group of ' +
      'theirs owns or that are shared with them (`servers` is `null` without `servers:read`), their own sessions, ' +
      'and runbook runs (`runs` is `null` without `runbooks:read`, and while the deployment records no runs). ' +
      'Reachability comes from stored connection-test results only; servers with none are `unknown`.',
  })
  @ApiResponse({ status: 200, description: 'The dashboard summary', type: DashboardSummaryDto })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Missing sessions:read, or no active organization' })
  summary(@CurrentPrincipal() principal: Principal): Promise<DashboardSummary> {
    return this.dashboard.summary(principal);
  }
}
