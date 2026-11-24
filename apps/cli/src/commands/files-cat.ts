import { UsageError } from '@marinoscar/platform-cli/commands';
import { CLI_NAME } from '@shellkeep/shared';
import type { Command } from 'commander';

import { CommandExit } from './exit.js';
import { type FilesDeps, resolveServer, withHint } from './files-http.js';

// `shellkeep files cat <server> <path> [--tail N | --head N] [--json]`  (issue #159)
//
// GET /api/server-profiles/:id/files/content?path=&offset=&length= answers a window of a text
// file (`{ text, offset, length, size, eof }`): its length is capped by the server, a file above
// the paged limit is refused (FILE_TOO_LARGE) and a binary file is FILE_IS_BINARY. This command
// reads window by window and writes each as it arrives, so it never holds more than one window
// (`--head` stops as soon as it has its lines; `--tail` walks backwards from the end and keeps
// only the lines it still needs).
//
// `--json`: one JSON object per line (`{ path, offset, length, size, eof, text }`), one per
// window for a whole file and one for `--head` / `--tail`.

interface Window {
  text: string;
  offset: number;
  length: number;
  size: number;
  eof: boolean;
}

/** Bytes a backward window reaches past its end, so a character split across two windows is in one of them. */
const OVERLAP = 4;

/** The largest backward window asked for when the first window does not say (it normally does). */
const MAX_BACK_WINDOW = 256 * 1024;

/** Counts the newlines of a string. */
function newlines(text: string): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count += 1;
  return count;
}

/** The first `lines` lines of `text` (with their newlines). */
export function firstLines(text: string, lines: number): string {
  let end = -1;
  for (let found = 0; found < lines; found += 1) {
    end = text.indexOf('\n', end + 1);
    if (end === -1) return text;
  }
  return text.slice(0, end + 1);
}

/** The last `lines` lines of `text`; a final newline does not start a line. */
export function lastLines(text: string, lines: number): string {
  const trailing = text.endsWith('\n');
  const body = trailing ? text.slice(0, -1) : text;
  let start = body.length;
  for (let found = 0; found < lines; found += 1) {
    const previous = body.lastIndexOf('\n', start - 1);
    if (previous === -1) return text;
    start = previous;
  }
  return `${body.slice(start + 1)}${trailing ? '\n' : ''}`;
}

const HINTS = (server: string, path: string): Record<string, string> => ({
  FILE_IS_BINARY: `Download it instead: ${CLI_NAME} files get ${server} ${path}`,
  FILE_TOO_LARGE: `Too large to read as text; download it instead: ${CLI_NAME} files get ${server} ${path}`,
});

export interface CatOptions {
  head?: number | undefined;
  tail?: number | undefined;
  json?: boolean | undefined;
}

/** Reads and prints a file. */
export async function catFile(deps: FilesDeps, server: string, path: string, options: CatOptions): Promise<void> {
  const id = await resolveServer(deps, server);
  const route = `/server-profiles/${encodeURIComponent(id)}/files/content`;
  const read = async (offset?: number, length?: number): Promise<Window> => {
    try {
      return await deps.client().get<Window>(route, { query: { path, offset, length } });
    } catch (error) {
      return withHint(error, HINTS(server, path));
    }
  };
  const emit = (window: Window, text: string, offset: number, length: number): void => {
    if (options.json === true) {
      writeJsonLine(deps, { path, offset, length, size: window.size, eof: offset + length >= window.size, text });
    } else {
      deps.stdout.write(text);
    }
  };

  const first = await read();

  if (options.tail !== undefined) {
    const lines = options.tail;
    let held = first.text;
    let heldStart = 0;
    if (!first.eof) {
      held = '';
      heldStart = first.size;
      const windowSize = Math.max(1, Math.min(first.length - OVERLAP, MAX_BACK_WINDOW));
      while (heldStart > 0 && newlines(held.endsWith('\n') ? held.slice(0, -1) : held) < lines) {
        const from = Math.max(0, heldStart - windowSize);
        const window = await read(from, heldStart - from + OVERLAP);
        if (window.offset >= heldStart || window.offset + window.length < heldStart) throw new CommandExit('the server returned a short window; try again', 1);
        const keep = Buffer.from(window.text, 'utf8').subarray(0, heldStart - window.offset).toString('utf8');
        held = keep + held;
        heldStart = window.offset;
      }
    }
    const text = lastLines(held, lines);
    emit(first, text, first.size - Buffer.byteLength(text), Buffer.byteLength(text));
    return;
  }

  let window = first;
  let remaining = options.head;
  for (;;) {
    if (remaining === undefined) {
      emit(window, window.text, window.offset, window.length);
    } else {
      const count = newlines(window.text);
      if (count >= remaining) {
        const text = firstLines(window.text, remaining);
        emit(window, text, window.offset, Buffer.byteLength(text));
        return;
      }
      emit(window, window.text, window.offset, window.length);
      remaining -= count;
    }
    if (window.eof) return;
    if (window.length <= 0) throw new CommandExit('the server returned an empty window before the end of the file', 1);
    window = await read(window.offset + window.length);
  }
}

function writeJsonLine(deps: FilesDeps, value: unknown): void {
  deps.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseLines(option: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`${option} must be a positive whole number`);
  return Number(value);
}

/** Adds `cat` to the `files` group. */
export function registerFilesCat(group: Command, deps: FilesDeps): void {
  group
    .command('cat')
    .description('Print a text file from a server, one window at a time')
    .argument('<server>', 'server profile name or id')
    .argument('<path>', 'file to read')
    .option('--head <n>', 'only the first N lines')
    .option('--tail <n>', 'only the last N lines')
    .option('--json', 'print one JSON object per window instead of text')
    .action(async (server: string, path: string, options: { head?: string; tail?: string; json?: boolean }) => {
      if (options.head !== undefined && options.tail !== undefined) throw new UsageError('use --head or --tail, not both');
      await catFile(deps, server, path, {
        head: options.head !== undefined ? parseLines('--head', options.head) : undefined,
        tail: options.tail !== undefined ? parseLines('--tail', options.tail) : undefined,
        json: options.json,
      });
    });
}
