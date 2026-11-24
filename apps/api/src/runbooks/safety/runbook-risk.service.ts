// =============================================================================
// Runbook risk assessment (issue #67)
// =============================================================================
//
// `assessDefinition(definition)` answers "what is dangerous in this runbook, and where". PURE: no Nest, no
// Prisma, no I/O, so the builder (#65), `POST /api/runbooks/validate`, the GET responses and the run launcher
// all read the same answer.
//
//   command / script     `classifyCommand` (#56) on EACH LINE of the body; a step's risk is the highest of its
//                        lines and it is destructive when any line is. A quoted mention in an `echo` is only
//                        `medium` (see classify-command.ts); the table is data: `destructive-patterns.ts`.
//   package_update       `packages: 'all'`: medium
//   file_upload          to /etc/*, /boot/* or /usr/*: medium; with `overwrite: true`: high, NOT destructive
//   ai_task              `approvalMode: 'autonomous_within_allowlist'`: medium ("AI may run allowlisted
//                        commands without approval")
//
// A definition is `destructive` when at least one step is. Only a destructive definition needs the
// launch-time confirmation and the two-person rule (`RunbookRunsService.create`).
//
// A finding names a step and its reasons, never the command text: a response carrying a finding cannot leak
// a command that held a secret.
// =============================================================================

import { Injectable } from '@nestjs/common';

import { classifyCommand, type CommandRisk } from '../../command-safety';
import type { RunbookDefinition, RunbookStep, RunbookStepKind } from '../schema/runbook-definition.schema';

export interface RiskFinding {
  stepId: string;
  stepIndex: number;
  kind: RunbookStepKind;
  risk: CommandRisk;
  /** This step alone makes the runbook destructive. */
  destructive: boolean;
  reasons: string[];
  /** 1-based line numbers of a `command` or `script` body that matched; absent for the other kinds. */
  lines?: number[];
}

export interface DefinitionRisk {
  /** At least one step is destructive: launching needs a confirmation (and an approval). */
  destructive: boolean;
  /** The highest risk of any step (`low` when there are no findings). */
  risk: CommandRisk;
  findings: RiskFinding[];
}

const ORDER: Record<CommandRisk, number> = { low: 0, medium: 1, high: 2 };
const SENSITIVE_UPLOAD_DIRS = ['/etc/', '/boot/', '/usr/'] as const;

export const AI_AUTONOMOUS_REASON = 'AI may run allowlisted commands without approval';

const max = (a: CommandRisk, b: CommandRisk): CommandRisk => (ORDER[a] >= ORDER[b] ? a : b);

/** The risk of the lines of a shell or script body. */
function assessBody(body: string): { risk: CommandRisk; destructive: boolean; reasons: string[]; lines: number[] } {
  let risk: CommandRisk = 'low';
  let destructive = false;
  const reasons: string[] = [];
  const lines: number[] = [];
  body.split(/\r?\n/).forEach((line, index) => {
    const result = classifyCommand(line);
    if (result.risk === 'low') return;
    risk = max(risk, result.risk);
    destructive = destructive || result.destructive;
    lines.push(index + 1);
    for (const reason of result.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  });
  return { risk, destructive, reasons, lines };
}

function assessStep(step: RunbookStep): Omit<RiskFinding, 'stepId' | 'stepIndex' | 'kind'> | null {
  switch (step.kind) {
    case 'command':
    case 'script': {
      const body = assessBody(step.kind === 'command' ? step.command : step.body);
      return body.risk === 'low' ? null : body;
    }
    case 'package_update':
      return step.packages === 'all'
        ? { risk: 'medium', destructive: false, reasons: ['Upgrades every installed package'] }
        : null;
    case 'file_upload': {
      if (!SENSITIVE_UPLOAD_DIRS.some((dir) => step.destPath.startsWith(dir))) return null;
      return step.overwrite
        ? { risk: 'high', destructive: false, reasons: [`Overwrites a file under ${step.destPath.split('/').slice(0, 2).join('/')}`] }
        : { risk: 'medium', destructive: false, reasons: [`Writes a file under ${step.destPath.split('/').slice(0, 2).join('/')}`] };
    }
    case 'ai_task':
      return step.approvalMode === 'autonomous_within_allowlist'
        ? { risk: 'medium', destructive: false, reasons: [AI_AUTONOMOUS_REASON] }
        : null;
    case 'collect_logs':
    case 'approval_gate':
      return null;
  }
}

export function assessDefinition(definition: Pick<RunbookDefinition, 'steps'>): DefinitionRisk {
  const findings: RiskFinding[] = [];
  definition.steps.forEach((step, stepIndex) => {
    const assessed = assessStep(step);
    if (!assessed) return;
    findings.push({ stepId: step.id, stepIndex, kind: step.kind, ...assessed });
  });
  return {
    destructive: findings.some((f) => f.destructive),
    risk: findings.reduce<CommandRisk>((acc, f) => max(acc, f.risk), 'low'),
    findings,
  };
}

@Injectable()
export class RunbookRiskService {
  assessDefinition(definition: Pick<RunbookDefinition, 'steps'>): DefinitionRisk {
    return assessDefinition(definition);
  }
}
