// =============================================================================
// Capture boundary guard (issue #56)
// =============================================================================
//
// `tmux capture-pane` is the one way terminal text leaves a server. It may appear
// in exactly one source file, `terminal/session-history.service.ts`, so every
// capture is reachable only through `SessionHistoryService`, and an AI feature can
// only get text through `TerminalContextService` (consent, switch, redaction).
// =============================================================================

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');
const ALLOWED = ['terminal/session-history.service.ts'];
const NEEDLE = 'capture-pane';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files under `root` (other than the allowed ones) whose text contains `capture-pane`. */
export function findCaptureViolations(root: string, allowed: readonly string[] = ALLOWED): string[] {
  return walk(root)
    .map((file) => relative(root, file).split(sep).join('/'))
    .filter((rel) => !allowed.includes(rel))
    .filter((rel) => readFileSync(join(root, rel), 'utf8').includes(NEEDLE));
}

describe('capture boundary', () => {
  it('only session-history.service.ts contains capture-pane', () => {
    expect(findCaptureViolations(SRC)).toEqual([]);
  });

  it('the allowed file really does contain it (the guard is not vacuous)', () => {
    expect(readFileSync(join(SRC, ALLOWED[0]), 'utf8')).toContain(NEEDLE);
  });

  it('fails against a planted violation', () => {
    const root = mkdtempSync(join(tmpdir(), 'capture-boundary-'));
    try {
      mkdirSync(join(root, 'terminal'), { recursive: true });
      writeFileSync(join(root, 'terminal/session-history.service.ts'), `run('tmux ${NEEDLE} -p')`);
      writeFileSync(join(root, 'terminal/leak.ts'), `run('tmux ${NEEDLE} -p -t x')`);
      writeFileSync(join(root, 'terminal/fine.ts'), 'run("tmux list-sessions")');
      expect(findCaptureViolations(root)).toEqual(['terminal/leak.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
