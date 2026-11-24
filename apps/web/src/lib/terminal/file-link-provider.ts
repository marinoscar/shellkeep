/**
 * The xterm.js link provider for file references (issue #155), registered by
 * `useTerminal` beside the `WebLinksAddon`. xterm asks for the links of a row
 * when the pointer hovers it; the provider finds the references on that row's
 * logical line (wrapped rows joined) with `findFileReferences`, asks the
 * source whether each exists (a cached `stat`), and returns only the ones that
 * do, so a path that is not there is never underlined.
 */
import type { IBufferCell, IBufferLine, IBufferRange, ILink, ILinkProvider } from '@xterm/xterm';
import { findFileReferences, type FileReference } from './file-links';
import type { FileStatLike } from './file-stat-cache';

/** The part of an xterm `Terminal` the provider reads. */
export interface FileLinkTerminal {
  cols: number;
  rows: number;
  element?: HTMLElement;
  buffer: {
    active: {
      viewportY: number;
      length: number;
      getLine: (y: number) => IBufferLine | undefined;
    };
  };
}

/** A reference whose path exists, with where it sits in the buffer. */
export interface ResolvedFileLink {
  reference: FileReference;
  stat: FileStatLike;
  /** The link text as printed (path plus `:line:col`). */
  text: string;
  /** 1-based, end inclusive (xterm's link range). */
  range: IBufferRange;
}

/** Where a link was activated, in client pixels: the menu opens there. */
export interface PointerPosition {
  x: number;
  y: number;
}

/** What the provider asks of its host; `null` turns the links off. */
export interface TerminalFileLinkSource {
  /** The stat of `path` (relative paths resolve against the session), or `null` when missing. */
  resolve: (path: string) => Promise<FileStatLike | null>;
  /** A link was clicked. */
  activate: (link: ResolvedFileLink, pointer: PointerPosition, event: MouseEvent) => void;
}

/** A wrapped line is joined across at most this many rows. */
const MAX_LOGICAL_ROWS = 16;

interface LogicalLine {
  text: string;
  /** Per UTF-16 unit of `text`: its cell (0-based buffer coordinates) and width. */
  cells: Array<{ x: number; y: number; width: number }>;
}

/** The logical line (wrapped rows joined) that buffer row `row` (0-based) belongs to. */
export function readLogicalLine(terminal: FileLinkTerminal, row: number): LogicalLine | null {
  const buffer = terminal.buffer.active;
  const first = buffer.getLine(row);
  if (!first) return null;
  let top = row;
  while (top > 0 && row - top < MAX_LOGICAL_ROWS && buffer.getLine(top)?.isWrapped) top -= 1;
  let bottom = row;
  while (bottom - top < MAX_LOGICAL_ROWS - 1 && buffer.getLine(bottom + 1)?.isWrapped) bottom += 1;

  let text = '';
  const cells: LogicalLine['cells'] = [];
  let reuse: IBufferCell | undefined;
  for (let y = top; y <= bottom; y += 1) {
    const line = buffer.getLine(y);
    if (!line) break;
    const length = Math.min(line.length, terminal.cols);
    for (let x = 0; x < length; x += 1) {
      const cell = line.getCell(x, reuse);
      if (!cell) break;
      reuse = cell;
      const width = cell.getWidth();
      if (width === 0) continue; // The right half of a wide character.
      const chars = cell.getChars() || ' ';
      text += chars;
      for (let i = 0; i < chars.length; i += 1) cells.push({ x, y, width });
    }
  }
  return { text, cells };
}

/** The xterm range (1-based, end inclusive) of a reference on a logical line. */
function rangeOf(line: LogicalLine, reference: FileReference): IBufferRange | null {
  const start = line.cells[reference.start];
  const end = line.cells[reference.end - 1];
  if (!start || !end) return null;
  return { start: { x: start.x + 1, y: start.y + 1 }, end: { x: end.x + end.width, y: end.y + 1 } };
}

/** The references on buffer row `row` (0-based), with their ranges. Nothing is asked of the server. */
export function fileReferencesOnRow(
  terminal: FileLinkTerminal,
  row: number,
): Array<{ reference: FileReference; text: string; range: IBufferRange }> {
  const line = readLogicalLine(terminal, row);
  if (!line) return [];
  const result: Array<{ reference: FileReference; text: string; range: IBufferRange }> = [];
  for (const reference of findFileReferences(line.text)) {
    const range = rangeOf(line, reference);
    if (!range) continue;
    // Only the references that touch this row (xterm asks row by row).
    if (range.end.y - 1 < row || range.start.y - 1 > row) continue;
    result.push({ reference, text: line.text.slice(reference.start, reference.end), range });
  }
  return result;
}

function contains(range: IBufferRange, x: number, y: number): boolean {
  // `x`, `y` are 1-based like the range.
  if (y < range.start.y || y > range.end.y) return false;
  if (y === range.start.y && x < range.start.x) return false;
  if (y === range.end.y && x > range.end.x) return false;
  return true;
}

/** The buffer cell (0-based) under a client point, or `null` outside the terminal's screen. */
export function cellAtPoint(terminal: FileLinkTerminal, clientX: number, clientY: number): { x: number; y: number } | null {
  const screen = terminal.element?.querySelector('.xterm-screen') ?? terminal.element;
  if (!screen || terminal.cols <= 0 || terminal.rows <= 0) return null;
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const col = Math.floor(((clientX - rect.left) / rect.width) * terminal.cols);
  const row = Math.floor(((clientY - rect.top) / rect.height) * terminal.rows);
  if (col < 0 || row < 0 || col >= terminal.cols || row >= terminal.rows) return null;
  return { x: col, y: terminal.buffer.active.viewportY + row };
}

/** The reference under a client point (not yet checked against the server). */
export function fileReferenceAtPoint(
  terminal: FileLinkTerminal,
  clientX: number,
  clientY: number,
): { reference: FileReference; text: string; range: IBufferRange } | null {
  const cell = cellAtPoint(terminal, clientX, clientY);
  if (!cell) return null;
  return fileReferencesOnRow(terminal, cell.y).find((found) => contains(found.range, cell.x + 1, cell.y + 1)) ?? null;
}

/**
 * The provider. `getSource` is read on every call, so the host can switch the
 * links on and off (or change the server) without re-registering.
 */
export function createFileLinkProvider(
  terminal: FileLinkTerminal,
  getSource: () => TerminalFileLinkSource | null | undefined,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const source = getSource();
      if (!source) {
        callback(undefined);
        return;
      }
      const found = fileReferencesOnRow(terminal, bufferLineNumber - 1);
      if (found.length === 0) {
        callback(undefined);
        return;
      }
      void Promise.all(
        found.map(async (candidate): Promise<ILink | null> => {
          const stat = await source.resolve(candidate.reference.path).catch(() => null);
          if (!stat) return null;
          const link: ResolvedFileLink = { ...candidate, stat };
          return {
            range: candidate.range,
            text: candidate.text,
            decorations: { underline: true, pointerCursor: true },
            activate: (event) => {
              // The host may have turned links off since the hover.
              const current = getSource();
              current?.activate(link, { x: event.clientX, y: event.clientY }, event);
            },
          };
        }),
      ).then((links) => {
        const existing = links.filter((link): link is ILink => link !== null);
        callback(existing.length > 0 ? existing : undefined);
      });
    },
  };
}
