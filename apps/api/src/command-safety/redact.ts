// =============================================================================
// Terminal-text redaction (issue #56)
// =============================================================================
//
// Pure: no Nest, no I/O. `redactText` replaces secrets with `[REDACTED:<kind>]`
// and reports counts per kind (never the matched text). It is DEFENCE IN DEPTH,
// not a guarantee: the per-server `aiOutputSharing` switch is the hard control.
//
// Callers: `TerminalContextService` (#56), the runbook engine (#62).
// =============================================================================

export type RedactionMode = 'standard' | 'strict';

/** Every kind `redactText` can report (the metric's `kind` label values). */
export const REDACTION_KINDS = [
  'aws_access_key',
  'aws_secret',
  'github_token',
  'slack_token',
  'google_api_key',
  'llm_key',
  'jwt',
  'private_key',
  'url_credentials',
  'auth_header',
  'kv_secret',
  'platform_token',
  'literal',
  'high_entropy',
] as const;

export type RedactionKind = (typeof REDACTION_KINDS)[number];

export interface RedactionFinding {
  kind: RedactionKind;
  count: number;
}

export interface RedactOptions {
  /** Exact values to remove wherever they appear (for example a runbook's secret parameters). */
  extraLiterals?: readonly string[];
  mode?: RedactionMode;
}

export interface RedactResult {
  text: string;
  findings: RedactionFinding[];
}

/** The replacement token for a kind. */
export const redactionToken = (kind: RedactionKind): string => `[REDACTED:${kind}]`;
export const REDACTED_LINE = '[REDACTED LINE]';

interface Rule {
  kind: RedactionKind;
  re: RegExp;
  /** Builds the replacement from the match; defaults to the whole-match token. */
  replace?: (match: string, ...groups: string[]) => string;
}

// Order matters: whole-block and prefix-specific rules run before generic ones.
const RULES: readonly Rule[] = [
  {
    kind: 'private_key',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  },
  { kind: 'jwt', re: /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g },
  { kind: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: 'aws_secret',
    re: /(aws_secret_access_key["']?[ \t]*[=:][ \t]*["']?)[A-Za-z0-9/+=]{40}/gi,
    replace: (_m, prefix) => `${prefix}${redactionToken('aws_secret')}`,
  },
  { kind: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/g },
  { kind: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'llm_key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'platform_token', re: /\b(?:pat|oat|ort|nod)_[A-Za-z0-9_-]{16,}/g },
  {
    kind: 'auth_header',
    re: /(Authorization:[ \t]*)(?:Bearer|Basic)[ \t]+\S+/gi,
    replace: (_m, prefix) => `${prefix}${redactionToken('auth_header')}`,
  },
  {
    // Keeps the scheme and the host; the userinfo is removed.
    kind: 'url_credentials',
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@]+@/gi,
    replace: (_m, scheme) => `${scheme}${redactionToken('url_credentials')}@`,
  },
  {
    // Keeps the key and the separator; the value is removed.
    kind: 'kv_secret',
    re: /(?<![A-Za-z0-9])([\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)["']?[ \t]*[=:][ \t]*)(?!\[REDACTED)\S+/gi,
    replace: (_m, prefix) => `${prefix}${redactionToken('kv_secret')}`,
  },
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]+$/i;
const CANDIDATE = /[A-Za-z0-9+/=_-]{24,}/g;

/** Decides whether a candidate run is a high-entropy secret. `before` is the text preceding it. */
function isHighEntropy(token: string, before: string): boolean {
  if (token.includes('[REDACTED')) return false;
  if (UUID.test(token)) return false;
  if (HEX.test(token)) {
    // git/sha1 lengths and a sha256 digest right after `sha256:` are never secrets.
    if (token.length <= 40) return false;
    if (token.length === 64 && /sha256:$/i.test(before)) return false;
    return token.length >= 48 && shannon(token) >= 3.0;
  }
  // File paths and other separator-heavy runs are not secrets.
  if ((token.match(/\//g) ?? []).length >= 3) return false;
  if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) return false;
  return shannon(token) >= 4.0;
}

/**
 * Redacts secrets from terminal text. Never throws; returns the redacted text and per-kind counts.
 * In `strict` mode every line that had a finding is replaced by `[REDACTED LINE]`.
 */
export function redactText(text: string, options: RedactOptions = {}): RedactResult {
  const mode = options.mode ?? 'standard';
  const counts = new Map<RedactionKind, number>();
  const bump = (kind: RedactionKind, n = 1) => counts.set(kind, (counts.get(kind) ?? 0) + n);

  let out = text;

  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      bump(rule.kind);
      const groups = args.slice(1, -2) as string[];
      return rule.replace ? rule.replace(args[0] as string, ...groups) : redactionToken(rule.kind);
    });
  }

  const literals = [...new Set((options.extraLiterals ?? []).filter((l) => l.length >= 3))].sort(
    (a, b) => b.length - a.length,
  );
  for (const literal of literals) {
    out = out.replace(new RegExp(escapeRegExp(literal), 'g'), () => {
      bump('literal');
      return redactionToken('literal');
    });
  }

  out = out.replace(CANDIDATE, (match, offset: number, whole: string) => {
    if (!isHighEntropy(match, whole.slice(Math.max(0, offset - 7), offset))) return match;
    bump('high_entropy');
    return redactionToken('high_entropy');
  });

  if (mode === 'strict' && counts.size > 0) {
    out = out
      .split('\n')
      .map((line) => (line.includes('[REDACTED:') ? REDACTED_LINE : line))
      .join('\n');
  }

  const findings = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return { text: out, findings };
}
