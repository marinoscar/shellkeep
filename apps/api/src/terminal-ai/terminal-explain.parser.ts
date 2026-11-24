// =============================================================================
// Reading the model's answer to an explain request (issue #58)
// =============================================================================
//
// The answer is markdown with fixed sections and an optional LAST line `COMMAND: <one line>`.
// The command is validated exactly like command assist's (one plain line, no control character);
// an invalid one is dropped, not repaired, and the explanation is still returned. The COMMAND
// line is removed from the markdown so the web client shows the fix once, in the Insert card.
// =============================================================================

import { assistResultSchema } from './terminal-assist.parser';

export const EXPLAIN_MARKDOWN_MAX = 8000;

export interface ExplainParsed {
  markdown: string;
  /** The raw suggested command text; the caller classifies it. Absent when none or unusable. */
  command?: string;
}

export function parseExplainOutput(text: string): ExplainParsed | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // The last non-empty line may be the COMMAND line; a COMMAND line earlier in prose is not one.
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === '') end--;
  let command: string | undefined;
  if (end > 0 && /^\s*COMMAND:/i.test(lines[end - 1] as string)) {
    const raw = (lines[end - 1] as string).replace(/^\s*COMMAND:/i, '').trim();
    const unwrapped = /^`([^`]+)`$/.exec(raw)?.[1] ?? raw;
    const parsed = assistResultSchema.shape.command.safeParse(unwrapped);
    if (parsed.success) command = parsed.data;
    end--;
  }
  const markdown = lines.slice(0, end).join('\n').trim().slice(0, EXPLAIN_MARKDOWN_MAX);
  if (markdown === '') return null;
  return command === undefined ? { markdown } : { markdown, command };
}
