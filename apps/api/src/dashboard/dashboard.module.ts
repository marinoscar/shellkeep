import { Module } from '@nestjs/common';

import { sharingModule } from '../platform/sharing/sharing.config';
import { RunbooksModule } from '../runbooks/runbooks.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The Home dashboard (#78): `GET /api/dashboard/summary`. Read-only and additive.
 *
 * Runs: `RunbooksModule` binds `DASHBOARD_RUNS_SOURCE` (`dashboard-runs.source.ts`) with
 * `runbooks/engine/runs-dashboard.source.ts`, and this module imports it.
 */
@Module({
  imports: [PrismaModule, sharingModule, RunbooksModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
