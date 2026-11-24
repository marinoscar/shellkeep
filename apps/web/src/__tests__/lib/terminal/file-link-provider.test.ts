import { describe, it, expect, vi } from 'vitest';
import type { IBufferCell, IBufferLine, ILink } from '@xterm/xterm';
import {
  cellAtPoint,
  createFileLinkProvider,
  fileReferenceAtPoint,
  fileReferencesOnRow,
  type FileLinkTerminal,
  type TerminalFileLinkSource,
} from '../../../lib/terminal/file-link-provider';
import { createFileStatCache, effectiveFileType, type FileStatLike } from '../../../lib/terminal/file-stat-cache';

/** A fake terminal whose rows are `rows`; `wrapped[i]` marks row i as a continuation. */
function fakeTerminal(rows: string[], cols = 40, wrapped: boolean[] = []): FileLinkTerminal {
  const lines: IBufferLine[] = rows.map((text, y) => {
    const padded = text.padEnd(cols, ' ');
    return {
      isWrapped: Boolean(wrapped[y]),
      length: cols,
      getCell: (x: number) =>
        ({ getChars: () => (padded[x] === ' ' ? '' : padded[x]), getWidth: () => 1 }) as unknown as IBufferCell,
      translateToString: () => text,
    } as unknown as IBufferLine;
  });
  return { cols, rows: rows.length, buffer: { active: { viewportY: 0, length: lines.length, getLine: (y) => lines[y] } } };
}

const fileStat = (path: string, type: FileStatLike['type'] = 'file'): FileStatLike => ({ path, type, isText: true });

function provide(terminal: FileLinkTerminal, source: TerminalFileLinkSource | null, row: number): Promise<ILink[] | undefined> {
  const provider = createFileLinkProvider(terminal, () => source);
  return new Promise((resolve) => provider.provideLinks(row, resolve));
}

describe('file link provider (#155)', () => {
  it('maps a reference to its 1-based, end-inclusive range', () => {
    const terminal = fakeTerminal(['cat /etc/hosts']);
    expect(fileReferencesOnRow(terminal, 0)).toEqual([
      expect.objectContaining({ text: '/etc/hosts', range: { start: { x: 5, y: 1 }, end: { x: 14, y: 1 } } }),
    ]);
  });

  it('joins a wrapped line, so a path split across rows is one link', () => {
    const terminal = fakeTerminal(['see /var/log/', 'app.log'], 13, [false, true]);
    const found = fileReferencesOnRow(terminal, 1);
    expect(found).toHaveLength(1);
    expect(found[0].reference.path).toBe('/var/log/app.log');
    expect(found[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 7, y: 2 } });
  });

  it('returns a link for a path that exists, with underline', async () => {
    const resolve = vi.fn(async (path: string) => fileStat(`/home/a/${path}`));
    const links = await provide(fakeTerminal(['open config.yaml']), { resolve, activate: vi.fn() }, 1);
    expect(resolve).toHaveBeenCalledWith('config.yaml');
    expect(links).toHaveLength(1);
    expect(links?.[0]).toMatchObject({ text: 'config.yaml', decorations: { underline: true, pointerCursor: true } });
  });

  it('returns no link for a path that does not exist', async () => {
    const resolve = vi.fn(async () => null);
    expect(await provide(fakeTerminal(['open missing.yaml']), { resolve, activate: vi.fn() }, 1)).toBeUndefined();
  });

  it('treats a failed check as missing', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await provide(fakeTerminal(['/etc/x.conf']), { resolve, activate: vi.fn() }, 1)).toBeUndefined();
  });

  it('asks nothing when the links are off or the row has no reference', async () => {
    expect(await provide(fakeTerminal(['/etc/hosts']), null, 1)).toBeUndefined();
    const resolve = vi.fn();
    expect(await provide(fakeTerminal(['hello world']), { resolve, activate: vi.fn() }, 1)).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('activates with the resolved link and the pointer position', async () => {
    const activate = vi.fn();
    const links = await provide(
      fakeTerminal(['src/app.ts:12']),
      { resolve: async () => fileStat('/repo/src/app.ts'), activate },
      1,
    );
    const event = new MouseEvent('click', { clientX: 30, clientY: 40 });
    links?.[0].activate(event, 'src/app.ts:12');
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({ reference: expect.objectContaining({ path: 'src/app.ts', line: 12 }), stat: fileStat('/repo/src/app.ts') }),
      { x: 30, y: 40 },
      event,
    );
  });

  it('finds the reference under a client point', () => {
    const terminal = fakeTerminal(['cat /etc/hosts', ''], 20);
    const element = document.createElement('div');
    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    element.appendChild(screen);
    screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 40 }) as DOMRect;
    terminal.element = element;
    // 10 px per column, 20 px per row.
    expect(cellAtPoint(terminal, 55, 5)).toEqual({ x: 5, y: 0 });
    expect(fileReferenceAtPoint(terminal, 55, 5)?.reference.path).toBe('/etc/hosts');
    expect(fileReferenceAtPoint(terminal, 15, 5)).toBeNull();
    expect(cellAtPoint(terminal, 500, 5)).toBeNull();
  });
});

describe('file stat cache (#155)', () => {
  it('caches an answer for the TTL, either way', async () => {
    let now = 0;
    const stat = vi.fn(async (path: string) => {
      if (path === 'gone') throw new Error('404');
      return fileStat(path);
    });
    const cache = createFileStatCache({ stat, ttlMs: 30_000, now: () => now });
    await cache.get('s1', 'a');
    await cache.get('s1', 'a');
    expect(await cache.get('s1', 'gone')).toBeNull();
    expect(await cache.get('s1', 'gone')).toBeNull();
    expect(stat).toHaveBeenCalledTimes(2);
    expect(cache.peek('s1', 'a')).toEqual(fileStat('a'));
    now = 30_000;
    expect(cache.peek('s1', 'a')).toBeUndefined();
    await cache.get('s1', 'a');
    expect(stat).toHaveBeenCalledTimes(3);
  });

  it('keys by session and path', async () => {
    const stat = vi.fn(async (path: string) => fileStat(path));
    const cache = createFileStatCache({ stat });
    await cache.get('s1', 'a');
    await cache.get('s2', 'a');
    expect(stat).toHaveBeenCalledTimes(2);
  });

  it('deduplicates a request already in flight', async () => {
    let release!: () => void;
    const stat = vi.fn(() => new Promise<FileStatLike>((resolve) => (release = () => resolve(fileStat('/a')))));
    const cache = createFileStatCache({ stat });
    const first = cache.get('s1', 'a');
    const second = cache.get('s1', 'a');
    await Promise.resolve();
    await Promise.resolve();
    release();
    expect(await first).toEqual(await second);
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it('keeps at most a few requests in flight', async () => {
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let peak = 0;
    const stat = vi.fn(
      (path: string) =>
        new Promise<FileStatLike>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve(fileStat(path));
          });
        }),
    );
    const cache = createFileStatCache({ stat, maxInFlight: 3 });
    const all = Promise.all(['a', 'b', 'c', 'd', 'e'].map((p) => cache.get('s1', p)));
    const flush = async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    };
    await flush();
    expect(stat).toHaveBeenCalledTimes(3);
    while (releases.length) {
      releases.shift()!();
      await flush();
    }
    await all;
    expect(stat).toHaveBeenCalledTimes(5);
    expect(peak).toBe(3);
  });

  it('reads a symlink as what it points to', () => {
    expect(effectiveFileType({ path: '/l', type: 'symlink', targetType: 'dir' })).toBe('dir');
    expect(effectiveFileType({ path: '/l', type: 'symlink', targetType: null })).toBe('other');
    expect(effectiveFileType({ path: '/f', type: 'file' })).toBe('file');
  });
});
