import { Injectable, Optional } from '@nestjs/common';
import { AppMetricsService } from '@marinoscar/platform-api/host';

import {
  RUNBOOK_APPROVALS_METRIC,
  RUNBOOK_COMMANDS_METRIC,
  RUNBOOK_RUNS_FINISHED_METRIC,
  RUNBOOK_TARGET_DURATION_METRIC,
} from '../runbooks.metrics';

/** The engine's four metrics. A metrics fault never reaches the work. */
@Injectable()
export class EngineMetricsService {
  constructor(@Optional() private readonly metrics?: AppMetricsService) {}

  runFinished(status: string, trigger: string): void {
    this.safely(() => this.metrics?.add(RUNBOOK_RUNS_FINISHED_METRIC, 1, { status, trigger }));
  }

  targetDuration(seconds: number, status: string): void {
    this.safely(() => this.metrics?.record(RUNBOOK_TARGET_DURATION_METRIC, seconds, { status }));
  }

  command(origin: string, outcome: string): void {
    this.safely(() => this.metrics?.add(RUNBOOK_COMMANDS_METRIC, 1, { origin, outcome }));
  }

  approval(kind: string, decision: string): void {
    this.safely(() => this.metrics?.add(RUNBOOK_APPROVALS_METRIC, 1, { kind, decision }));
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // metrics must never fail the work
    }
  }
}
