#!/usr/bin/env node
// Fails (exit 1) when a top-level directory under the classified roots has no row in
// docs/platform-adoption/module-classification.md. A row is a table line whose first cell
// is the directory path in backticks, e.g. | `apps/api/src/auth` | ... |
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = ['apps/api/src', 'apps/web/src', 'apps/web/src/components', 'apps/web/src/pages', 'infra'];
const doc = join(root, 'docs/platform-adoption/module-classification.md');

if (!existsSync(doc)) {
  console.error(`check-classification: ${doc} is missing`);
  process.exit(1);
}

const rows = new Map();
for (const line of readFileSync(doc, 'utf8').split('\n')) {
  const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
  if (m) rows.set(m[1], (rows.get(m[1]) ?? 0) + 1);
}

const problems = [];
for (const r of roots) {
  const abs = join(root, r);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs).sort()) {
    if (!statSync(join(abs, name)).isDirectory()) continue;
    const path = `${r}/${name}`;
    const n = rows.get(path) ?? 0;
    if (n === 0) problems.push(`no row for ${path}`);
    else if (n > 1) problems.push(`${n} rows for ${path} (expected exactly one)`);
  }
}

if (problems.length > 0) {
  console.error('check-classification: docs/platform-adoption/module-classification.md is out of date:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-classification: every top-level directory has exactly one row.');
