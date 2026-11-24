import { Injectable, Optional } from '@nestjs/common';
import { AppMetricsService } from '@marinoscar/platform-api/host';

import {
  RUNBOOK_AI_TOOL_CALLS_METRIC,
  RUNBOOK_APPROVALS_METRIC,
  RUNBOOK_ARTIFACT_BYTES_METRIC,
  RUNBOOK_BUNDLE_BUILDS_METRIC,
  type ArtifactKind,
  type BundleOutcome,
  RUNBOOK_COMMANDS_METRIC,
  RUNBOOK_DESTRUCTIVE_RUNS_METRIC,
  RUNBOOK_DRY_RUNS_METRIC,
  type DestructiveRunOutcome,
  RUNBOOK_RUNS_FINISHED_METRIC,
  RUNBOOK_TARGET_DURATION_METRIC,
} from '../runbooks.metrics';

/** The engine's metrics. A metrics fault never reaches the work. */
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

  destructiveRun(outcome: DestructiveRunOutcome): void {
    this.safely(() => this.metrics?.add(RUNBOOK_DESTRUCTIVE_RUNS_METRIC, 1, { outcome }));
  }

  artifactBytes(kind: ArtifactKind, bytes: number): void {
    this.safely(() => this.metrics?.record(RUNBOOK_ARTIFACT_BYTES_METRIC, bytes, { kind }));
  }

  bundleBuild(outcome: BundleOutcome): void {
    this.safely(() => this.metrics?.add(RUNBOOK_BUNDLE_BUILDS_METRIC, 1, { outcome }));
  }

  aiToolCall(tool: string, decision: string): void {
    this.safely(() => this.metrics?.add(RUNBOOK_AI_TOOL_CALLS_METRIC, 1, { tool, decision }));
  }

  dryRun(): void {
    this.safely(() => this.metrics?.add(RUNBOOK_DRY_RUNS_METRIC, 1, {}));
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // metrics must never fail the work
    }
  }
}
