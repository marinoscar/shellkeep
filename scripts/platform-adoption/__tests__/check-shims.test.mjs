// Proves scripts/platform-adoption/check-shims.mjs accepts a consistent ledger and rejects
// each kind of disagreement between markers, ledger rows and platform.lock.
// Run: node --test scripts/platform-adoption/__tests__/
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRepo, parseLedger } from '../check-shims.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ok');
const LEDGER = 'docs/platform-adoption/local-exceptions.md';
const dirs = [];

/** A copy of the ok fixture, optionally changed by `mutate(root, rewrite)`. */
function repo(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'check-shims-'));
  dirs.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const rewrite = (rel, fn) => writeFileSync(join(root, rel), fn(readFileSync(join(root, rel), 'utf8')));
  mutate?.(root, rewrite);
  return root;
}
const problems = (root) => checkRepo(root).problems;
const has = (list, text) => list.some((p) => p.includes(text));

after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('check-shims', () => {
  it('accepts a consistent ledger', () => {
    const r = checkRepo(repo());
    assert.deepEqual(r.problems, []);
    assert.equal(r.markers.length, 2);
  });

  it('fails when a marker has no row', () => {
    const root = repo((r) => {
      mkdirSync(join(r, 'apps/web/src'), { recursive: true });
      writeFileSync(join(r, 'apps/web/src/extra.ts'), '// PLATFORM-ADOPTION-SHIM(#903): not in the ledger\n');
    });
    assert.ok(has(problems(root), 'apps/web/src/extra.ts: has a PLATFORM-ADOPTION-SHIM marker but no row'));
  });

  it('fails when deleting the row of a marker', () => {
    const root = repo((r, rw) => rw(LEDGER, (t) => t.replace(/^\| Demo shim .*\n/m, '')));
    assert.ok(has(problems(root), 'apps/api/src/demo/shim.ts: has a PLATFORM-ADOPTION-SHIM marker but no row'));
  });

  it('fails when a Code shims row names a file with no marker', () => {
    const root = repo((r) => rmSync(join(r, 'infra/nginx/demo.conf')));
    assert.ok(has(problems(root), '"infra/nginx/demo.conf" carries no PLATFORM-ADOPTION-SHIM marker'));
  });

  it('fails on a malformed marker', () => {
    const root = repo((r, rw) => rw('apps/api/src/demo/shim.ts', (t) => t.replace('(#901)', ': oops')));
    assert.ok(has(problems(root), 'malformed marker'));
  });

  it('fails when a row has an empty "Removed by"', () => {
    const root = repo((r, rw) => rw(LEDGER, (t) => t.replace('| #901 |', '|  |')));
    assert.ok(has(problems(root), 'empty "Removed by"'));
  });

  it('fails when "Removed by" of a main-table row is only prose', () => {
    const root = repo((r, rw) => rw(LEDGER, (t) => t.replace('| #901 |', '| someday |')));
    assert.ok(has(problems(root), 'must name an issue'));
  });

  it('fails on a bare "Permanent" with no reason', () => {
    const root = repo((r, rw) => rw(LEDGER, (t) => t.replace('Permanent: single organization', 'Permanent')));
    assert.ok(has(problems(root), 'must name an issue'));
  });

  it('accepts prose in a decision table but not an empty cell there', () => {
    assert.deepEqual(problems(repo((r, rw) => rw(LEDGER, (t) => t.replace('| Kept |', '| Revisit later |')))), []);
    assert.ok(has(problems(repo((r, rw) => rw(LEDGER, (t) => t.replace('| Kept |', '|  |')))), 'empty "Removed by"'));
  });

  it('fails when a platform.lock deviation has no row', () => {
    const root = repo((r, rw) =>
      rw('apps/api/prisma/platform.lock', (t) => t.replace('{ "id": "example:domain-schema" }', '{ "id": "example:domain-schema" }, { "id": "example:other" }')),
    );
    assert.ok(has(problems(root), 'deviation "example:other" has no row'));
  });

  it('fails when a Database deviations row names an id the lock does not declare', () => {
    const root = repo((r, rw) => rw('apps/api/prisma/platform.lock', () => '{ "deviations": [] }\n'));
    assert.ok(has(problems(root), 'names "example:domain-schema"'));
  });

  it('parses tables by section and subsection', () => {
    const tables = parseLedger(readFileSync(join(FIXTURE, LEDGER), 'utf8'));
    assert.deepEqual(
      tables.map((t) => [t.section.split(' ')[0], t.sub]),
      [['Database', null], ['Code', null], ['Code', 'Decisions'], ['Standing', null], ['Drift', null]],
    );
  });
});
