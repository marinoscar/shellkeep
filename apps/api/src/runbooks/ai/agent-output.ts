// =============================================================================
// What a model is allowed to see of a command's output (issue #64)
// =============================================================================
//
// PURE. Everything a tool returns to the model goes through `prepareModelOutput`, in this order:
//
//   1. ANSI sequences are stripped;
//   2. the text is redacted with `redactText` and the run's secret values as exact literals, so a pane
//      secret a command printed shows as `[REDACTED:literal]` or `[REDACTED:<kind>]`;
//   3. it is cut to 8 KiB (head and tail kept, `[truncated]` in the middle).
//
// The whole output is redacted BEFORE it is cut, so a secret straddling the cut cannot survive as a
// fragment.
// =============================================================================

import { redactText, stripAnsi } from '../../command-safety';

export const MODEL_OUTPUT_MAX_BYTES = 8 * 1024;
export const TRUNCATED_MARKER = '\n[truncated]\n';

/** Cuts `text` to `maxBytes` UTF-8 bytes, keeping its start and end. */
export function truncateMiddle(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  const marker = Buffer.byteLength(TRUNCATED_MARKER, 'utf8');
  const room = Math.max(0, maxBytes - marker);
  const headBytes = Math.ceil(room / 2);
  const tailBytes = room - headBytes;
  let headEnd = headBytes;
  // Never end the head inside a multi-byte character.
  while (headEnd > 0 && (buffer[headEnd]! & 0xc0) === 0x80) headEnd -= 1;
  let tailStart = buffer.length - tailBytes;
  while (tailStart < buffer.length && (buffer[tailStart]! & 0xc0) === 0x80) tailStart += 1;
  return {
    text: buffer.subarray(0, headEnd).toString('utf8') + TRUNCATED_MARKER + buffer.subarray(tailStart).toString('utf8'),
    truncated: true,
  };
}

/** Control-sequence free, redacted, capped: the only form in which output reaches a model. */
export function prepareModelOutput(raw: string, secretLiterals: readonly string[], maxBytes: number = MODEL_OUTPUT_MAX_BYTES): { text: string; truncated: boolean } {
  const literals = secretLiterals.filter((s) => s.length > 0);
  const redacted = redactText(stripAnsi(raw), { extraLiterals: literals }).text;
  return truncateMiddle(redacted, maxBytes);
}

/** Redacts a short text the model or the engine wrote (a command, a reason, a summary) before it is stored or logged. */
export function redactForStorage(text: string, secretLiterals: readonly string[], maxChars: number): string {
  const redacted = redactText(text, { extraLiterals: secretLiterals.filter((s) => s.length > 0) }).text;
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}…` : redacted;
}
