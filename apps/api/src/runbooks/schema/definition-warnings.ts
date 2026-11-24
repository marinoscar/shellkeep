// Non-blocking findings about a VALID definition (issue #61), returned by
// `POST /api/runbooks/validate`. A warning never stops a save.

import type { RunbookDefinition } from './runbook-definition.schema';

export interface DefinitionWarning {
  /** Stable identifier of the finding. */
  readonly code: string;
  /** JSON path of the field the finding is about. */
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export function definitionWarnings(definition: RunbookDefinition): DefinitionWarning[] {
  const warnings: DefinitionWarning[] = [];

  const first = definition.steps[0];
  if (first && first.when === 'on_failure') {
    warnings.push({
      code: 'FIRST_STEP_ON_FAILURE',
      path: ['steps', 0, 'when'],
      message: 'The first step runs only after a failure, but nothing runs before it: it will never run.',
    });
  }

  definition.steps.forEach((step, index) => {
    if (step.kind === 'ai_task' && step.approvalMode === 'autonomous_within_allowlist' && step.deny.length === 0) {
      warnings.push({
        code: 'AI_AUTONOMOUS_WITHOUT_DENY',
        path: ['steps', index, 'deny'],
        message: 'Autonomous mode has no deny patterns: only the allow list limits what the AI may run.',
      });
    }
    if (step.kind === 'file_upload' && step.overwrite) {
      warnings.push({
        code: 'FILE_UPLOAD_OVERWRITES',
        path: ['steps', index, 'overwrite'],
        message: 'This step replaces an existing file at the destination.',
      });
    }
  });

  const targets = definition.defaultTargets;
  if (
    targets.serverIds.length === 0 &&
    targets.tags.any.length === 0 &&
    targets.tags.all.length === 0 &&
    targets.groupIds.length === 0
  ) {
    warnings.push({
      code: 'NO_DEFAULT_TARGETS',
      path: ['defaultTargets'],
      message: 'No default targets: every run must choose its servers.',
    });
  }

  return warnings;
}
