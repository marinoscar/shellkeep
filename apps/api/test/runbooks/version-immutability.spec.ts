// =============================================================================
// Runbook versions are append-only (issue #61)
// =============================================================================
//
// A grep over the API sources: no code path may update or delete a `runbook_versions` row.
// The only way one goes away is the cascade of a runbook purge (a foreign key, not code).
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const FORBIDDEN = /\brunbookVersion\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\s*\(/;
const RAW = /(UPDATE|DELETE\s+FROM)\s+"?runbook_versions"?/i;

describe('runbook version immutability', () => {
  const files = listTs(SRC).map((full) => ({ full, rel: relative(SRC, full).split(sep).join('/') }));

  it('scans the sources', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.rel === 'runbooks/runbooks.service.ts')).toBe(true);
  });

  it('finds no runbookVersion update, updateMany, upsert, delete or deleteMany, and no raw statement on the table', () => {
    const violations = files.flatMap((f) =>
      readFileSync(f.full, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, where: `${f.rel}:${i + 1}` }))
        .filter(({ line }) => FORBIDDEN.test(line) || RAW.test(line))
        .map(({ where, line }) => `${where}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });

  it('detects what it should', () => {
    expect(FORBIDDEN.test('await tx.runbookVersion.update({})')).toBe(true);
    expect(FORBIDDEN.test('tx.runbookVersion.deleteMany(')).toBe(true);
    expect(FORBIDDEN.test('tx.runbookVersion.create({})')).toBe(false);
    expect(RAW.test('DELETE FROM runbook_versions')).toBe(true);
  });
});
