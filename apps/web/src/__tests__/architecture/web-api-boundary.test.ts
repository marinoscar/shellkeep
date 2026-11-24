import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * The web never imports API source (#65). The production web image copies `apps/web` alone, so
 * an import that climbs into `apps/api` breaks the image build, and the UI must present what the
 * API sends rather than share its code. Wire types are declared in the web (for example
 * `features/runbooks/api/definition.ts`) or come from a package the web image installs.
 *
 * Every module specifier (static, type-only, dynamic, `vi.mock`) under `src/` must resolve
 * inside `apps/web`.
 */
const SRC = resolve(__dirname, '..', '..');
const WEB = resolve(SRC, '..');

const SPECIFIER = /(?:\bfrom|^\s*import|\bimport\(|\brequire\(|\bvi\.mock\()\s*['"]([^'"]+)['"]/gm;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('web to API boundary', () => {
  const files = sources(SRC);

  it('scans the web sources (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('imports nothing outside apps/web by a relative path', () => {
    const escapes: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const spec = match[1]!;
        if (!spec.startsWith('.')) continue;
        const target = resolve(file, '..', spec);
        if (!(target === WEB || target.startsWith(WEB + sep))) {
          escapes.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(escapes, 'Declare the wire type in the web instead of importing API source').toEqual([]);
  });

  it('names no apps/api module by any path', () => {
    const offenders = files.filter((file) =>
      [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].some((m) => /(^|\/)api\/src\//.test(m[1]!) || m[1]!.includes('apps/api')),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
