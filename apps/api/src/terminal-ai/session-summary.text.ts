// Pure helpers for the session summary (#59): splitting a long redacted capture into chunks and
// cleaning the model's answer. No I/O, no Nest, no terminal text is logged or kept here.

import { redactText, type RedactionFinding } from '../command-safety';

/** The largest slice of capture one model call reads. A longer capture is summarized in parts (map-reduce). */
export const SUMMARY_CHUNK_CHARS = 60_000;

export const SUMMARY_MAX_MD_CHARS = 20_000;
export const SUMMARY_MAX_COMMANDS = 100;
export const SUMMARY_MAX_COMMAND_CHARS = 1_000;

export type CommandOutcome = 'ok' | 'error' | 'unknown';
export interface SummaryCommand {
  command: string;
  outcome?: CommandOutcome;
}

/**
 * Splits `text` into pieces of at most `max` characters, on line boundaries. A single line longer than
 * `max` is cut into `max`-sized pieces so no piece ever exceeds the limit. Concatenating the pieces with
 * a newline reproduces the text (except at cuts inside an over-long line).
 */
export function splitIntoChunks(text: string, max: number = SUMMARY_CHUNK_CHARS): string[] {
  if (text.length <= max) return text === '' ? [] : [text];
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current !== '') chunks.push(current);
    current = '';
  };
  for (const line of text.split('\n')) {
    if (line.length > max) {
      flush();
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
      continue;
    }
    const next = current === '' ? line : `${current}\n${line}`;
    if (next.length > max) {
      flush();
      current = line;
    } else {
      current = next;
    }
  }
  flush();
  return chunks;
}

/** Sums findings of the same kind (the capture's and the answer's). */
export function mergeFindings(...lists: readonly RedactionFinding[][]): RedactionFinding[] {
  const counts = new Map<RedactionFinding['kind'], number>();
  for (const list of lists) for (const f of list) counts.set(f.kind, (counts.get(f.kind) ?? 0) + f.count);
  return [...counts].map(([kind, count]) => ({ kind, count }));
}

export interface CleanedSummary {
  summaryMd: string;
  commands: SummaryCommand[];
  findings: RedactionFinding[];
}

/**
 * The answer as it is stored: redacted a second time (the model saw only redacted text, but it may
 * rebuild or invent a secret-shaped string), capped, and with empty commands dropped.
 */
export function cleanSummary(answer: { summaryMd: string; commands: readonly SummaryCommand[] }): CleanedSummary {
  const md = redactText(answer.summaryMd.slice(0, SUMMARY_MAX_MD_CHARS));
  const findings: RedactionFinding[][] = [md.findings];
  const commands: SummaryCommand[] = [];
  for (const entry of answer.commands) {
    if (commands.length >= SUMMARY_MAX_COMMANDS) break;
    const redacted = redactText(entry.command.trim().slice(0, SUMMARY_MAX_COMMAND_CHARS));
    if (redacted.text === '') continue;
    findings.push(redacted.findings);
    commands.push(entry.outcome ? { command: redacted.text, outcome: entry.outcome } : { command: redacted.text });
  }
  return { summaryMd: md.text, commands, findings: mergeFindings(...findings) };
}
