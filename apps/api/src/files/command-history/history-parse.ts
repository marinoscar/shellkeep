// =============================================================================
// Shell history file parsers (issue #173)
// =============================================================================
//
// Pure: no Nest, no I/O. A history file is read from the END (the caller reads the last bytes
// only), so the first line of a tail may be cut and is dropped by `tailText`. Parsers return
// commands OLDEST FIRST, exactly as the file orders them; `normalizeHistory` dedupes and puts
// the newest first. Nothing here logs.
// =============================================================================

export type HistoryShell = 'bash' | 'zsh' | 'fish';

/** The files tried, in a fixed order, relative to the login home. No path comes from a user. */
export const HISTORY_FILES: ReadonlyArray<{ shell: HistoryShell; path: string }> = [
  { shell: 'bash', path: '.bash_history' },
  { shell: 'zsh', path: '.zsh_history' },
  { shell: 'fish', path: '.local/share/fish/fish_history' },
];

/** The most bytes read from the end of a history file. */
export const MAX_HISTORY_TAIL_BYTES = 256 * 1024;
/** The most entries returned, and kept in the cache. */
export const MAX_HISTORY_ENTRIES = 500;
/** A command longer than this is skipped (a pasted blob is not a command to re-run). */
export const MAX_COMMAND_CHARS = 2000;

/** The text of a file's tail; when the read did not start at byte 0 the first (possibly cut) line is dropped. */
export function tailText(buffer: Buffer, startedAtZero: boolean): string {
  const text = buffer.toString('utf8');
  if (startedAtZero) return text;
  const nl = text.indexOf('\n');
  return nl === -1 ? '' : text.slice(nl + 1);
}

/** bash: one command per line; `#<epoch>` lines (HISTTIMEFORMAT) are timestamps, not commands. */
export function parseBash(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (/^#\d{9,}$/.test(line.trim())) continue;
    out.push(line);
  }
  return out;
}

/** zsh: plain lines, or the extended format `: <epoch>:<elapsed>;<command>`; a trailing `\` continues on the next line. */
export function parseZsh(text: string): string[] {
  const out: string[] = [];
  let pending: string | null = null;
  for (const raw of text.split('\n')) {
    let line = raw;
    if (pending === null) {
      const m = /^: \d+:\d+;(.*)$/s.exec(line);
      if (m) line = m[1];
    }
    const joined: string = pending === null ? line : `${pending}\n${line}`;
    if (/(?<!\\)(?:\\\\)*\\$/.test(line)) {
      pending = joined.slice(0, -1);
      // Keep the continuation visible as a real newline: the backslash is dropped.
      continue;
    }
    pending = null;
    out.push(joined);
  }
  if (pending !== null) out.push(pending);
  return out;
}

/** fish: `- cmd: <text>` entries followed by indented `when:` / `paths:` lines; `\n` and `\\` are escaped. */
export function parseFish(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('- cmd: ')) continue;
    out.push(
      line.slice('- cmd: '.length).replace(/\\(n|\\)/g, (_m, c: string) => (c === 'n' ? '\n' : '\\')),
    );
  }
  return out;
}

export function parseHistory(shell: HistoryShell, text: string): string[] {
  return shell === 'bash' ? parseBash(text) : shell === 'zsh' ? parseZsh(text) : parseFish(text);
}

/**
 * Oldest-first commands to the list shown: trimmed, empty and oversized entries dropped, deduped
 * (the NEWEST occurrence wins), newest first, at most `limit`.
 */
export function normalizeHistory(oldestFirst: readonly string[], limit = MAX_HISTORY_ENTRIES): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = oldestFirst.length - 1; i >= 0 && out.length < limit; i--) {
    // eslint-disable-next-line no-control-regex
    const command = oldestFirst[i].replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (command === '' || command.length > MAX_COMMAND_CHARS) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    out.push(command);
  }
  return out;
}
