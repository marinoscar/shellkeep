// =============================================================================
// Does a snippet body look like a credential? (issue #172)
// =============================================================================
//
// A snippet is typed into a terminal, but it is stored in the database in plain text and shown on every
// device, so a pasted password, token or private key does not belong in one. This check is a WARNING, never
// a block: it errs towards flagging, the user decides. It runs on save; its result is a boolean and the body
// is never logged, so a flagged body does not leak through the detector either.
//
// Flagged:
//   - a PEM private-key header (`-----BEGIN ... PRIVATE KEY-----`, also OpenSSH and PGP blocks);
//   - `password=`, `passwd:`, `secret=`, `token=`, `api_key=` ... with a literal value (a `{{placeholder}}`,
//     a `$VARIABLE` or a `<value>` is NOT a literal);
//   - well-known token shapes: AWS access key ids (`AKIA...`), GitHub (`ghp_`, `github_pat_`), Slack (`xox*-`),
//     Stripe and OpenAI-style `sk-` keys, Google API keys (`AIza...`), JSON web tokens;
//   - `Authorization: Bearer <token>`, `sshpass -p <value>`, and credentials inside a URL (`://user:pass@`);
//   - a long, high-entropy token (32+ characters of a base64/URL-safe alphabet, mixed case and digits).
// =============================================================================

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;

// name = value, where the name looks like a credential. The value must be literal and at least 4 chars.
const KEY_VALUE =
  /\b(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|client[_-]?secret)\b["']?\s*[=:]\s*["']?([^\s"'&;]{4,})/gi;

const KNOWN_TOKENS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\bsshpass\s+-p\s*\S{2,}/i,
  /:\/\/[^\s/:@]+:[^\s/@]{3,}@/,
];

const LONG_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

function isPlaceholder(value: string): boolean {
  return value.startsWith('{{') || value.startsWith('$') || value.startsWith('<') || value.startsWith('%') || /^[*x•]+$/i.test(value);
}

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function looksLikeHighEntropyToken(token: string): boolean {
  // A path, a flag or a plain word is not a token; lower-case hex (a git or sha sum) is not a secret.
  if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/[0-9]/.test(token)) return false;
  return entropy(token) >= 4.2;
}

/** True when the body should carry the `looks-like-secret` warning. */
export function looksLikeSecret(body: string): boolean {
  if (PRIVATE_KEY.test(body)) return true;
  if (KNOWN_TOKENS.some((pattern) => pattern.test(body))) return true;
  for (const match of body.matchAll(KEY_VALUE)) {
    if (!isPlaceholder(match[1])) return true;
  }
  for (const match of body.matchAll(LONG_TOKEN)) {
    if (looksLikeHighEntropyToken(match[0])) return true;
  }
  return false;
}
