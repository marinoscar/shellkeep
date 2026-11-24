// =============================================================================
// Command-risk classifier (issue #56)
// =============================================================================
//
// Pure. `classifyCommand` tests a command line against the table in
// `destructive-patterns.ts`:
//
//   high    a destructive row matched
//   medium  a medium row matched (sudo, package removal, service restart, rm -r),
//           or a destructive row matched only inside a quoted echo/printf argument
//   low     nothing matched
//
// ACCEPTED LIMITATION: this is text matching, not a shell parser. `echo "rm -rf /"`
// is therefore reported `medium` (documented, deliberate: a quoted mention is not
// executed, but a human should still look). Extend the table, not this function.
// =============================================================================

import { DESTRUCTIVE_PATTERNS, MEDIUM_PATTERNS } from './destructive-patterns';

export type CommandRisk = 'low' | 'medium' | 'high';

export interface CommandClassification {
  risk: CommandRisk;
  destructive: boolean;
  reasons: string[];
}

/** `echo`/`printf` whose whole remaining text is a quoted string: the text is only printed. */
const QUOTED_PRINT = /^\s*(?:echo|printf)\b(?:\s+-[a-zA-Z]+)*\s+(?:"[^"]*"|'[^']*')\s*$/;

export function classifyCommand(command: string): CommandClassification {
  const cmd = command.trim();
  if (cmd === '') return { risk: 'low', destructive: false, reasons: [] };

  const quotedOnly = QUOTED_PRINT.test(cmd);
  const reasons: string[] = [];
  let destructive = false;
  let medium = false;

  for (const row of DESTRUCTIVE_PATTERNS) {
    if (!row.re.test(cmd)) continue;
    reasons.push(row.reason);
    if (quotedOnly) medium = true;
    else destructive = true;
  }
  for (const row of MEDIUM_PATTERNS) {
    if (!row.re.test(cmd)) continue;
    // A destructive `rm -r` row already explains the generic one.
    if (row.id === 'rm_recursive' && destructive) continue;
    if (!reasons.includes(row.reason)) reasons.push(row.reason);
    medium = true;
  }
  if (quotedOnly && reasons.length > 0) {
    reasons.push('Matched inside a quoted string that is only printed (reported as medium)');
  }

  if (destructive) return { risk: 'high', destructive: true, reasons };
  return { risk: medium ? 'medium' : 'low', destructive: false, reasons };
}
