/**
 * Pure text transforms of the file viewer (issue #154): ANSI stripping for
 * logs, `.env` masking, JSON formatting with a readable error position, and
 * the paged-mode offset math.
 */

// -----------------------------------------------------------------------------
// Logs
// -----------------------------------------------------------------------------

/**
 * CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL` or `ESC ] ... ESC \`) and the
 * two-byte escapes. Built from a string so the source holds no control byte.
 */
const ANSI_PATTERN = new RegExp(
  [
    '\\u001b\\[[0-?]*[ -/]*[@-~]',
    '\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)',
    '\\u001b[@-Z\\\\-_]',
    '\\u009b[0-?]*[ -/]*[@-~]',
  ].join('|'),
  'g',
);

/** The text without ANSI escape sequences (colours, cursor moves, titles). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** A log level the viewer highlights. */
export type LogLevel = 'error' | 'warn' | 'info';

/** The words of each level, matched whole and case-sensitively in upper case. */
export const LOG_LEVEL_PATTERN = /\b(?:(ERROR|ERR|FATAL|CRITICAL|CRIT|PANIC|EMERG|ALERT)|(WARN|WARNING)|(INFO|NOTICE))\b/g;

/** The level a matched word stands for. */
export function logLevelOf(word: string): LogLevel | null {
  LOG_LEVEL_PATTERN.lastIndex = 0;
  const match = LOG_LEVEL_PATTERN.exec(word);
  LOG_LEVEL_PATTERN.lastIndex = 0;
  if (!match) return null;
  if (match[1]) return 'error';
  if (match[2]) return 'warn';
  return 'info';
}

// -----------------------------------------------------------------------------
// .env masking
// -----------------------------------------------------------------------------

/** What a masked value shows: fixed length, so the mask reveals no length. */
export const ENV_MASK = '••••••••';

const ENV_ASSIGNMENT = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*)(.*)$/;

/** The `.env` text with every non-empty value replaced by {@link ENV_MASK}; comments stay. */
export function maskEnv(text: string): { text: string; masked: number } {
  let masked = 0;
  const lines = text.split('\n').map((line) => {
    const match = ENV_ASSIGNMENT.exec(line);
    if (!match || match[2]!.replace(/\r$/, '').trim() === '') return line;
    masked += 1;
    return `${match[1]}${ENV_MASK}`;
  });
  return { text: lines.join('\n'), masked };
}

// -----------------------------------------------------------------------------
// JSON
// -----------------------------------------------------------------------------

export type JsonCheck =
  | { ok: true; formatted: string }
  | { ok: false; message: string; line: number | null; column: number | null };

/** The 1-based line and column of a 0-based character position. */
export function lineColumnAt(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
}

/**
 * The character position of the first JSON syntax error, or `null` when the
 * scan finds none (a recursive-descent pass that only locates; `JSON.parse`
 * stays the judge of validity).
 */
export function jsonErrorPosition(text: string): number | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && /[ \t\n\r]/.test(text[i]!)) i += 1;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail();
  };
  const string = () => {
    i += 1;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        i += 1;
        return;
      }
      if (c === '\\') {
        i += 1;
        if (text[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail();
          i += 5;
        } else if (/["\\/bfnrt]/.test(text[i] ?? '')) i += 1;
        else fail();
      } else if (c < ' ') fail();
      else i += 1;
    }
    fail();
  };
  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail();
    i += match![0].length;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i += 1;
      ws();
      if (text[i] === '}') {
        i += 1;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string();
        ws();
        if (text[i] !== ':') fail();
        i += 1;
        value();
        ws();
        if (text[i] === ',') i += 1;
        else if (text[i] === '}') {
          i += 1;
          return;
        } else fail();
      }
    }
    if (c === '[') {
      i += 1;
      ws();
      if (text[i] === ']') {
        i += 1;
        return;
      }
      for (;;) {
        value();
        ws();
        if (text[i] === ',') i += 1;
        else if (text[i] === ']') {
          i += 1;
          return;
        } else fail();
      }
    }
    if (c === '"') return string();
    if (c === 't') return literal('true');
    if (c === 'f') return literal('false');
    if (c === 'n') return literal('null');
    return number();
  };
  try {
    value();
    ws();
    return i < text.length ? i : null;
  } catch (position) {
    return typeof position === 'number' ? Math.min(position, text.length) : null;
  }
}

/** Parses `text` as JSON: the pretty-printed form, or the error with its line and column. */
export function checkJson(text: string, indent = 2): JsonCheck {
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(text), null, indent) };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replace(/\s*\(line \d+ column \d+\)\s*$/, '');
    const lineColumn = /line (\d+) column (\d+)/.exec(raw);
    if (lineColumn) {
      return { ok: false, message, line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
    }
    const position = /at position (\d+)/.exec(raw);
    if (position) {
      const { line, column } = lineColumnAt(text, Number(position[1]));
      return { ok: false, message, line, column };
    }
    // Some engine messages carry no position ("Unexpected token '}', ... is not valid JSON").
    const found = jsonErrorPosition(text);
    if (found !== null) {
      const { line, column } = lineColumnAt(text, found);
      return { ok: false, message, line, column };
    }
    return { ok: false, message, line: null, column: null };
  }
}

// -----------------------------------------------------------------------------
// Paged mode
// -----------------------------------------------------------------------------

/** The offset of the last window of a file. */
export function tailOffset(size: number, windowBytes: number): number {
  return Math.max(0, size - windowBytes);
}

/** The offset of the window before the one starting at `offset`. */
export function previousOffset(offset: number, windowBytes: number): number {
  return Math.max(0, offset - windowBytes);
}

/** The offset at `percent` (0 to 100) of the file. */
export function percentOffset(size: number, percent: number): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return Math.min(size, Math.floor((size * clamped) / 100));
}

/**
 * A "jump to" entry as a byte offset: `42%` is a share of the file, a bare
 * number is a byte offset, `12k`/`3m` (KiB, MiB) are sizes. `null` when it is
 * not one of these or falls outside the file.
 */
export function parseJumpTarget(raw: string, size: number): number | null {
  const value = raw.trim().toLowerCase();
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(value);
  if (percent) {
    const share = Number(percent[1]);
    return share <= 100 ? percentOffset(size, share) : null;
  }
  const bytes = /^(\d+)\s*([kmg]?)b?$/.exec(value);
  if (!bytes) return null;
  const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[bytes[2] as '' | 'k' | 'm' | 'g'];
  const offset = Number(bytes[1]) * unit;
  return Number.isSafeInteger(offset) && offset <= size ? offset : null;
}

/** A byte count for display: `512 B`, `1.5 KB`, `2.0 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Keeps a followed buffer bounded: when `text` is longer than `max`
 * characters, drops whole lines from the start until it fits.
 */
export function trimToTail(text: string, max: number): { text: string; dropped: number } {
  if (text.length <= max) return { text, dropped: 0 };
  let cut = text.length - max;
  const newline = text.indexOf('\n', cut);
  if (newline !== -1) cut = newline + 1;
  return { text: text.slice(cut), dropped: cut };
}
