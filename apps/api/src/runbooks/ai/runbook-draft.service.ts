// =============================================================================
// AI drafting of a runbook (issue #64)
// =============================================================================
//
// `draft(principal, dto)` turns a plain-language description into a runbook DEFINITION. It never saves one
// and never runs one: the answer is `{ definition, warnings, risk }`, a person reads it, loads it into the
// builder and saves it through the normal route (which validates again).
//
//   * one `respondStructured` call under `{ feature: 'runbook_draft' }` against the definition schema of #61,
//     so a malformed or cross-field-invalid answer is `AI_STRUCTURED_OUTPUT_INVALID`, never returned;
//   * the model is told what the servers ARE (name, OS, package manager from stored facts) and nothing a
//     server printed: no terminal output reaches a draft;
//   * the instructions forbid inline secrets (use `secret` parameters) and steer toward `package_update`,
//     `collect_logs` and `approval_gate`, with `when: always` on log collection;
//   * the result is checked a second time (`RunbooksService.parseDefinition`), then judged: the definition
//     warnings of #61, a warning per risky command from the classifier of #56/#67, and one if anything
//     secret-shaped sits in the draft. Warnings never block; they are what the reader should look at first.
// =============================================================================

import { ForbiddenException, Injectable } from '@nestjs/common';
import { AiService } from '@marinoscar/platform-api/ai';
import type { Principal } from '@marinoscar/platform-api/core';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { redactText } from '../../command-safety';
import { ServerProfilesService } from '../../server-profiles/server-profiles.service';
import { RunbooksService } from '../runbooks.service';
import { definitionWarnings } from '../schema/definition-warnings';
import { runbookDefinitionSchema, type RunbookDefinition } from '../schema/runbook-definition.schema';
import { assessDefinition, type DefinitionRisk } from '../safety/runbook-risk.service';
import type { DraftRunbookDto } from './runbook-draft.dto';
import { RUNBOOK_DRAFT_FEATURE } from './runbook-agent.constants';

export interface DraftWarning {
  code: string;
  path: ReadonlyArray<string | number>;
  message: string;
}

export interface DraftResult {
  definition: RunbookDefinition;
  warnings: DraftWarning[];
  risk: DefinitionRisk;
}

export const DRAFT_INSTRUCTIONS = [
  'You draft runbooks: ordered procedures that run on Linux or Unix servers over SSH. Reply with ONE JSON object, the runbook definition, and nothing else.',
  '',
  'Definition rules:',
  '- schemaVersion is 1. steps has 1 to 50 steps; each has a unique lowercase id (letters, digits, - or _), a name, a `when` (on_success by default) and a kind.',
  '- Step kinds: command (one shell command line), script (a multi-line body with an interpreter), package_update (refresh and upgrade packages without naming the package manager),',
  '  collect_logs (gather log files and journal units), approval_gate (pause for a person), ai_task (hand a judgment task to an AI agent, with an approval mode and allow and deny patterns).',
  '- PREFER package_update for package upgrades, collect_logs for gathering logs, and approval_gate before any step that changes or restarts something important.',
  '- A collect_logs step MUST have `when: "always"`, so logs are gathered even when an earlier step failed.',
  '- Do NOT use file_upload (it needs a stored file you cannot name) and do NOT use ai_task unless the request asks for AI to decide something.',
  '- NEVER write a secret, password, token or key into the definition. When a value is secret, declare a parameter with type "secret" and use it in commands as an environment variable ($NAME).',
  '  Non-secret inputs are string, number, boolean or enum parameters, named in UPPER_SNAKE_CASE and also used as environment variables.',
  '- Commands run non-interactively under bash: no editors, pagers or prompts. Use `-y` style flags where a tool would ask.',
  '- Never include a destructive command (erasing disks, `rm -rf /`, shutdown or reboot of the whole host) unless the request explicitly asks for it.',
  '- Leave defaultTargets empty unless the request names servers by tag.',
  '- Keep names short and human. Use exact, boring commands; do not invent flags.',
].join('\n');

@Injectable()
export class RunbookDraftService {
  constructor(
    private readonly ai: AiService,
    private readonly runbooks: RunbooksService,
    private readonly profiles: ServerProfilesService,
  ) {}

  async draft(principal: Principal, dto: DraftRunbookDto): Promise<DraftResult> {
    // The route's own declaration may only name `ai:use` (the AI conformance suites allow no other); drafting
    // also needs the right to write runbooks, which is checked here, before any provider call.
    if (!principal.permissions.includes(PERMISSIONS.RUNBOOKS_WRITE)) throw new ForbiddenException('Missing permission: runbooks:write');
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');

    const context = await this.serverContext(principal, dto.targetHint);
    const answer = await this.ai
      .forUser(principal.userId, { orgId: principal.activeOrgId, feature: RUNBOOK_DRAFT_FEATURE })
      .respondStructured({
        instructions: DRAFT_INSTRUCTIONS,
        input: `${context}Request:\n<request>\n${dto.prompt}\n</request>`,
        schema: runbookDefinitionSchema,
        schemaName: 'runbook_definition',
        // The definition schema carries defaults and cross-field rules a provider's strict mode cannot express;
        // it is enforced by the validation below, not by the provider.
        strict: false,
      });

    // The same validation as saving (#61): the answer is returned only when a save would accept it.
    const definition = this.runbooks.parseDefinition(answer.parsed);
    return { definition, warnings: this.warningsFor(definition), risk: assessDefinition(definition) };
  }

  private warningsFor(definition: RunbookDefinition): DraftWarning[] {
    const warnings: DraftWarning[] = definitionWarnings(definition).map((w) => ({ code: w.code, path: w.path, message: w.message }));

    // One warning per step whose commands the classifier judges risky: the reasons, never the command text.
    for (const finding of assessDefinition(definition).findings) {
      if (finding.risk === 'low') continue;
      warnings.push({
        code: finding.destructive ? 'DESTRUCTIVE_STEP' : `RISK_${finding.risk.toUpperCase()}`,
        path: ['steps', finding.stepIndex],
        message: `${finding.destructive ? 'Destructive: launching needs a confirmation and a second person. ' : ''}${finding.reasons.join('; ')}`,
      });
    }

    // A secret-shaped value in the draft: the instructions forbid it, so its presence is worth a flag.
    if (redactText(JSON.stringify(definition)).findings.length > 0) {
      warnings.push({
        code: 'SECRET_IN_DRAFT',
        path: [],
        message: 'Something in this draft looks like a secret. Replace it with a secret parameter before saving.',
      });
    }
    return warnings;
  }

  /** What the model may know of the hinted servers: names and facts, only for servers the caller may read. */
  private async serverContext(principal: Principal, hint: DraftRunbookDto['targetHint']): Promise<string> {
    const lines: string[] = [];
    for (const id of hint?.serverIds ?? []) {
      try {
        const profile = await this.profiles.findOne(id, principal);
        const facts = profile.facts;
        const parts = facts
          ? [facts.prettyName ?? facts.os, facts.packageManager ? `package manager ${facts.packageManager}` : null, facts.shell ? `shell ${facts.shell}` : null].filter(Boolean)
          : ['facts unknown'];
        lines.push(`- ${profile.name}: ${parts.join(', ')}`);
      } catch {
        // A server the caller may not read is simply not described: the draft does not reveal it exists.
      }
    }
    const tags = hint?.tags ?? [];
    const out: string[] = [];
    if (lines.length > 0) out.push(`Servers this runbook is for (name: facts):\n${lines.join('\n')}`);
    if (tags.length > 0) out.push(`Servers are selected by these tags: ${tags.join(', ')}`);
    return out.length > 0 ? `${out.join('\n')}\n\n` : '';
  }
}
