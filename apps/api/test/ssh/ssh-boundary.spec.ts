// =============================================================================
// The SSH boundary (issue #60)
// =============================================================================
//
// `apps/api/src/ssh/ssh-connection.factory.ts` is the ONLY place that builds a
// `ConnectConfig` and creates an ssh2 `Client`. Every other connection path (terminal,
// test connection, history, Doctor probe, facts probe, runbooks) goes through the
// factory, so none can skip host-key verification.
//
// This spec scans the API sources for `new Client(` outside `src/ssh/` (and the scripts
// that mention ssh2: `scripts/test-db-connection.js` builds a `pg` client) and fails with
// the offending file and line. `findClientConstructions` is
// proven on planted strings so the guard itself cannot rot silently.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const API_DIR = join(__dirname, '..', '..');
const SCAN_ROOTS = [join(API_DIR, 'src'), join(API_DIR, 'scripts')];
const ALLOWED_DIR = join(API_DIR, 'src', 'ssh') + sep;

/** An ssh2 client construction: `new Client(`, `new ssh2.Client(`, `new (require('ssh2').Client)(`. */
const CONSTRUCTION = /\bnew\s+(?:\w+\.)?Client\s*\(|new\s*\(\s*require\(\s*['"]ssh2['"]\s*\)\.Client\s*\)/;

export function findClientConstructions(source: string): number[] {
  const lines: number[] = [];
  source.split('\n').forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '');
    if (CONSTRUCTION.test(code)) lines.push(index + 1);
  });
  return lines;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) yield path;
  }
}

describe('the SSH connection boundary', () => {
  it('flags a planted construction and ignores the look-alikes', () => {
    expect(findClientConstructions("const c = new Client();")).toEqual([1]);
    expect(findClientConstructions("x\nconst c = new ssh2.Client({});")).toEqual([2]);
    expect(findClientConstructions("const c = new (require('ssh2').Client)();")).toEqual([1]);
    expect(findClientConstructions("// new Client() in a comment")).toEqual([]);
    expect(findClientConstructions('const c = new HttpClient();')).toEqual([]);
    expect(findClientConstructions('const c = makeClient();')).toEqual([]);
  });

  it('finds no `new Client(` outside apps/api/src/ssh/', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        scanned += 1;
        if (file.startsWith(ALLOWED_DIR)) continue;
        // A spec may mock the library; the guard is about production connection paths.
        if (/\.spec\.ts$/.test(file)) continue;
        const source = readFileSync(file, 'utf8');
        // Under scripts/ only a file that touches ssh2 can be building an SSH client.
        if (file.startsWith(join(API_DIR, 'scripts') + sep) && !/ssh2/.test(source)) continue;
        for (const line of findClientConstructions(source)) {
          offenders.push(`${relative(API_DIR, file)}:${line}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('keeps the one construction the factory owns (the guard still looks at the right place)', () => {
    const factory = readFileSync(join(ALLOWED_DIR, 'ssh-connection.factory.ts'), 'utf8');
    expect(findClientConstructions(factory).length).toBeGreaterThanOrEqual(1);
  });
});
