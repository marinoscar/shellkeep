import { Module } from '@nestjs/common';

import { sharingModule } from '../platform/sharing/sharing.config';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The Home dashboard (#78): `GET /api/dashboard/summary`. Read-only and additive.
 *
 * Runs: the runbook engine (#62) binds `DASHBOARD_RUNS_SOURCE` (`dashboard-runs.source.ts`) and
 * this module imports the module that provides it; until then `runs` is `null`.
 */
@Module({
  imports: [PrismaModule, sharingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
