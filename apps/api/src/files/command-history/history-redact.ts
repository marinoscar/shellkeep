// =============================================================================
// Redaction of shell history entries (issue #173)
// =============================================================================
//
// History is shown in the browser, so every entry passes the terminal AI redactor
// (`command-safety/redact.ts`, the same `REDACTION_KINDS`) plus a command-line layer for the
// shapes only a command has: password flags, `sshpass -p`, `mysql -p<pw>`, `curl -u user:pw`,
// and a bare `NAME_PASS=value` assignment.
//
//   - an entry that is ENTIRELY a secret (nothing readable is left once the tokens go) is DROPPED;
//   - any other entry with a finding is MASKED (`[REDACTED:<kind>]` in place of the value).
//
// Redaction runs BEFORE the cache and BEFORE search, so a search cannot be used to probe a
// masked value. It is defence in depth, not a guarantee (a password typed at a wrong prompt
// looks like any word). Pure; nothing here logs.
// =============================================================================

import { redactText } from '../../command-safety';

export type HistoryRedactionKind = 'password_flag' | 'credential_assignment' | 'basic_auth_flag';

const MASK = (kind: HistoryRedactionKind): string => `[REDACTED:${kind}]`;
const VALUE = String.raw`("[^"]*"|'[^']*'|\S+)`;

interface CommandRule {
  kind: HistoryRedactionKind;
  re: RegExp;
  replace: (...groups: string[]) => string;
}

const NAME = String.raw`\w*(?:pass(?:word|wd)?|pwd|secret|token|api_?key|access_?key|private_?key|credential|auth)\w*`;

const COMMAND_RULES: readonly CommandRule[] = [
  {
    // sshpass -p secret ssh ... ; sshpass -psecret ...
    kind: 'password_flag',
    re: new RegExp(String.raw`(\bsshpass\b(?:\s+-[a-oq-zA-Z]\S*)*\s+-p\s*)${VALUE}`, 'g'),
    replace: (prefix) => `${prefix}${MASK('password_flag')}`,
  },
  {
    // mysql -pSECRET (attached: a bare -p prompts and carries no secret)
    kind: 'password_flag',
    re: /(\b(?:mysql|mysqldump|mysqladmin|mariadb|mysqlpump|mysqlimport)\b[^|;&\n]*?\s-p)(?!\[REDACTED)\S+/g,
    replace: (prefix) => `${prefix}${MASK('password_flag')}`,
  },
  {
    // --password SECRET, --password=SECRET, --token ..., --api-key ... (not --password-stdin)
    kind: 'password_flag',
    re: new RegExp(
      String.raw`(--(?:password|passwd|pass|token|secret|api[-_]?key|access[-_]?key|client[-_]secret|auth[-_]?token|bearer|credentials?)(?:=|\s+))(?!\[REDACTED)${VALUE}`,
      'gi',
    ),
    replace: (prefix) => `${prefix}${MASK('password_flag')}`,
  },
  {
    // curl -u user:pw, --user user:pw (the password half is the secret; the user stays)
    kind: 'basic_auth_flag',
    re: /(\bcurl\b[^|;&\n]*?\s(?:-u|--user)(?:=|\s+)["']?[^\s:"']+:)(?!\[REDACTED)[^\s"']+/g,
    replace: (prefix) => `${prefix}${MASK('basic_auth_flag')}`,
  },
  {
    // export DB_PASS=x, FOO_TOKEN=x cmd (an env var whose NAME says secret)
    kind: 'credential_assignment',
    re: new RegExp(String.raw`(?<![\w-])(${NAME}=)(?!\[REDACTED)${VALUE}`, 'gi'),
    replace: (prefix) => `${prefix}${MASK('credential_assignment')}`,
  },
];

export interface RedactedEntry {
  /** The entry as shown, or `null` when it was entirely a secret and is dropped. */
  command: string | null;
  /** True when something in it was masked. */
  masked: boolean;
}

/** What is left of a command once every redaction token and every non-word character is gone. */
function readable(text: string): string {
  return text
    .replace(/\[REDACTED(?: LINE)?(?::[a-z_]+)?\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function redactHistoryEntry(command: string): RedactedEntry {
  let out = command;
  let masked = false;
  for (const rule of COMMAND_RULES) {
    out = out.replace(rule.re, (...args) => {
      masked = true;
      const groups = args.slice(1, -2).filter((g): g is string => typeof g === 'string');
      return rule.replace(...groups);
    });
  }
  const result = redactText(out);
  if (result.findings.length > 0) masked = true;
  out = result.text;
  if (!masked) return { command: out, masked: false };
  // A bare secret (a pasted token, a key block) or a command whose only argument was one.
  if (readable(out) === '' || /^(?:\[REDACTED:[a-z_]+\]\s*)+$/.test(out.trim())) return { command: null, masked: true };
  return { command: out, masked: true };
}

/** The masked list, with `dropped` and `masked` counts (counts only; never the entries). */
export function redactHistory(commands: readonly string[]): { entries: Array<{ command: string; masked: boolean }>; dropped: number } {
  const entries: Array<{ command: string; masked: boolean }> = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of commands) {
    const r = redactHistoryEntry(raw);
    if (r.command === null) dropped += 1;
    else if (!seen.has(r.command)) {
      // Two secrets can mask to the same text: keep the first (the newest).
      seen.add(r.command);
      entries.push({ command: r.command, masked: r.masked });
    }
  }
  return { entries, dropped };
}
