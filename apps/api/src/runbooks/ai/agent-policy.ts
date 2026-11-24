// =============================================================================
// The command policy of an AI runbook step (issue #64)
// =============================================================================
//
// PURE: no Nest, no I/O. Every `run_command` the model asks for is judged here, in every approval mode,
// BEFORE anything is asked of a person or sent to a server. A command is allowed only when
//
//   1. it matches NO `deny` pattern (deny always wins, even over an allow match);
//   2. it is not destructive (`classifyCommand(...).destructive`, the table of `command-safety`): a
//      destructive command is refused even when an allow pattern matches it (`allow: ['.*']` does not
//      open `mkfs.ext4`);
//   3. it does not name a sensitive path (shadow files, SSH keys, `*.pem`, `*.key`);
//   4. in `autonomous_within_allowlist` mode, it matches AT LEAST ONE `allow` pattern. In `per_command`
//      and `plan` mode a person decides, so the allow list is not required (deny, destructive and
//      sensitive paths still refuse).
//
// `read_file` and `list_dir` are always allowed except for a sensitive path.
//
// Patterns are RE2: linear-time, so a hostile or careless pattern cannot stall the worker. A pattern that
// does not compile FAILS CLOSED: a `deny` pattern that cannot be compiled matches everything, an `allow`
// pattern that cannot be compiled matches nothing (a definition is validated when saved, so this only
// guards a row written by hand).
// =============================================================================

import { posix } from 'node:path';

import RE2 from 're2';

import { classifyCommand } from '../../command-safety';

export type AgentApprovalMode = 'per_command' | 'plan' | 'autonomous_within_allowlist';

export interface AgentPolicyConfig {
  approvalMode: AgentApprovalMode;
  allow: readonly string[];
  deny: readonly string[];
}

export type RefusalCode = 'DENY_PATTERN' | 'DESTRUCTIVE' | 'NOT_ALLOWLISTED' | 'SENSITIVE_PATH' | 'EMPTY';

export type PolicyDecision = { allowed: true } | { allowed: false; code: RefusalCode; reason: string };

/** Longest command the tool accepts (the tool's own schema enforces it too). */
export const MAX_COMMAND_LENGTH = 4096;

/**
 * Sensitive locations. Used on a path (`read_file`, `list_dir`) and, as text, on a command line. The
 * list is deliberately short and literal: it is a net under the allow list, not the access model.
 */
const SENSITIVE: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\/etc\/g?shadow/, label: 'a shadow password file' },
  { re: /(?:^|[\s/'"~=:])\.ssh(?=[\s/'"]|$)/, label: 'an SSH directory' },
  { re: /\/etc\/ssl\/private/, label: 'a private key directory' },
  { re: /\.(?:pem|key)(?![A-Za-z0-9_.-])/i, label: 'a key file (.pem or .key)' },
  { re: /\/proc\/[^\s/]+\/environ/, label: 'a process environment' },
];

const compile = (pattern: string): RE2 | null => {
  try {
    return new RE2(pattern, 'u');
  } catch {
    return null;
  }
};

/** The first sensitive location a text names, or `null`. */
export function sensitiveLocation(text: string): string | null {
  for (const row of SENSITIVE) if (row.re.test(text)) return row.label;
  return null;
}

export class AgentPolicy {
  private readonly allow: Array<RE2 | null>;
  private readonly deny: Array<RE2 | null>;

  constructor(private readonly config: AgentPolicyConfig) {
    this.allow = config.allow.map(compile);
    this.deny = config.deny.map(compile);
  }

  get mode(): AgentApprovalMode {
    return this.config.approvalMode;
  }

  /** Whether `command` may run. Never throws. */
  checkCommand(command: string): PolicyDecision {
    const text = command.trim();
    if (text === '') return { allowed: false, code: 'EMPTY', reason: 'The command is empty.' };

    // A deny pattern that does not compile (null) matches everything: fail closed.
    if (this.deny.some((re) => re === null || re.test(text))) {
      return { allowed: false, code: 'DENY_PATTERN', reason: 'The command matches the deny list of this step.' };
    }

    const risk = classifyCommand(text);
    if (risk.destructive) {
      const why = risk.reasons[0] ? ` (${risk.reasons[0]})` : '';
      return { allowed: false, code: 'DESTRUCTIVE', reason: `The command is destructive and is never run by an AI step${why}.` };
    }

    const sensitive = sensitiveLocation(text);
    if (sensitive) {
      return { allowed: false, code: 'SENSITIVE_PATH', reason: `The command names ${sensitive}, which an AI step may not touch.` };
    }

    if (this.config.approvalMode === 'autonomous_within_allowlist' && !this.allow.some((re) => re !== null && re.test(text))) {
      return { allowed: false, code: 'NOT_ALLOWLISTED', reason: 'The command matches no allow pattern of this step.' };
    }
    return { allowed: true };
  }

  /** Whether `path` may be read or listed. The path is normalised first, so `/a/../etc/shadow` is caught. */
  checkPath(path: string): PolicyDecision {
    if (!path.startsWith('/') || path.includes('\0')) {
      return { allowed: false, code: 'SENSITIVE_PATH', reason: 'The path must be absolute.' };
    }
    const normal = posix.normalize(path);
    const sensitive = sensitiveLocation(normal) ?? sensitiveLocation(path);
    if (sensitive) return { allowed: false, code: 'SENSITIVE_PATH', reason: `The path is ${sensitive}, which an AI step may not read.` };
    return { allowed: true };
  }
}
