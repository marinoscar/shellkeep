#!/usr/bin/env node
// =============================================================================
// Shim marker check: every PLATFORM-ADOPTION-SHIM marker has a ledger row, and
// the ledger has no row without its marker (issue #83)
// =============================================================================
//
// Usage:  node scripts/platform-adoption/check-shims.mjs [--root <dir>]
//
// Reads, under the root (default: the repository):
//   - every `PLATFORM-ADOPTION-SHIM(<issue>)` marker in `apps/*/src`,
//     `apps/api/prisma` and `infra/` (TS, Prisma, YAML, shell and nginx comments);
//   - the ledger `docs/platform-adoption/local-exceptions.md`: the tables of the
//     sections "Database deviations", "Code shims", "Standing constraints" and
//     "Drift allowlist";
//   - the `deviations[].id` of `apps/api/prisma/platform.lock`.
//
// It fails (exit 1) when:
//   1. a marker is malformed (not `PLATFORM-ADOPTION-SHIM(#<n>)`, optionally
//      `<repo>#<n>`);
//   2. a marker's file is named by no row of the "Code shims" table (its "Where"
//      column);
//   3. a "Code shims" row names a file (or folder) that carries no marker;
//   4. a row of a checked table has an empty "Removed by" cell (the last cell;
//      "Resolved by" and "Added by" count), or a row has fewer cells than its header;
//   5. a row of a main table (the first table of each checked section, not a
//      `###` decision table) has a "Removed by" that is none of: an issue or pull
//      request number (`#83`, `EnterpriseAppBase#1216`), a URL, or the word
//      `Permanent` followed by a reason;
//   6. a `platform.lock` deviation id has no "Database deviations" row (or a
//      "Database deviations" row names an id the lock does not declare).
//
// Exit codes: 0 ok | 1 check failed | 2 usage. Node built-ins only.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LEDGER = 'docs/platform-adoption/local-exceptions.md';
export const LOCK = 'apps/api/prisma/platform.lock';
const SCAN_ROOTS = ['apps/*/src', 'apps/api/prisma', 'infra'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo']);
const MAX_BYTES = 1024 * 1024;
const MARKER_WORD = 'PLATFORM-ADOPTION-SHIM';
const MARKER_OK = /PLATFORM-ADOPTION-SHIM\(((?:[\w.-]+\/)?(?:[\w.-]+)?#\d+)\)/g;
const CHECKED_SECTIONS = ['Database deviations', 'Code shims', 'Standing constraints', 'Drift allowlist'];

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** Every directory matched by a root pattern (`apps/*` + a suffix, or a plain path). */
function expandRoots(root) {
  const out = [];
  for (const pattern of SCAN_ROOTS) {
    const star = pattern.indexOf('/*/');
    if (star === -1) {
      out.push(pattern);
      continue;
    }
    const base = pattern.slice(0, star);
    const rest = pattern.slice(star + 3);
    const baseAbs = join(root, base);
    if (!existsSync(baseAbs)) continue;
    for (const name of readdirSync(baseAbs).sort()) {
      if (statSync(join(baseAbs, name)).isDirectory()) out.push(`${base}/${name}/${rest}`);
    }
  }
  return out;
}

function* walk(abs) {
  for (const name of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(abs, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile() && st.size <= MAX_BYTES) yield p;
  }
}

/**
 * Collects every marker under the scan roots.
 * @returns {{ file: string, line: number, issue: string | null }[]} `issue` is null for a malformed marker.
 */
export function collectMarkers(root) {
  const found = [];
  for (const r of expandRoots(root)) {
    const abs = join(root, r);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const file of walk(abs)) {
      const buf = readFileSync(file);
      if (buf.includes(0)) continue; // binary
      const text = buf.toString('utf8');
      if (!text.includes(MARKER_WORD)) continue;
      const rel = relative(root, file).split('\\').join('/');
      text.split('\n').forEach((lineText, i) => {
        if (!lineText.includes(MARKER_WORD)) return;
        MARKER_OK.lastIndex = 0;
        const good = [...lineText.matchAll(MARKER_OK)];
        const all = lineText.split(MARKER_WORD).length - 1;
        for (const m of good) found.push({ file: rel, line: i + 1, issue: m[1] });
        for (let k = good.length; k < all; k += 1) found.push({ file: rel, line: i + 1, issue: null });
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/**
 * Parses the tables of the ledger.
 * @returns {{ section: string, sub: string | null, header: string[], rows: { cells: string[], line: number }[] }[]}
 */
export function parseLedger(text) {
  const tables = [];
  let section = '';
  let sub = null;
  let current = null;
  text.split('\n').forEach((raw, i) => {
    const h2 = /^##\s+(.*)$/.exec(raw);
    const h3 = /^###\s+(.*)$/.exec(raw);
    if (h2) {
      section = h2[1].trim();
      sub = null;
      current = null;
      return;
    }
    if (h3) {
      sub = h3[1].trim();
      current = null;
      return;
    }
    if (!raw.startsWith('|')) {
      current = null;
      return;
    }
    if (/^\|\s*:?-{3,}/.test(raw)) return;
    if (current === null) {
      current = { section, sub, header: cells(raw), rows: [] };
      tables.push(current);
      return;
    }
    current.rows.push({ cells: cells(raw), line: i + 1 });
  });
  return tables;
}

const inSection = (table, name) => table.section.startsWith(name);
const backticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** True for a path-like token: has a slash and either an extension or a trailing slash. */
function pathToken(token) {
  const t = token.trim();
  if (/\s/.test(t) || !t.includes('/')) return null;
  return /\.[A-Za-z0-9]+$/.test(t) || t.endsWith('/') ? t : null;
}

const REMOVED_FORM = /#\d+\b|https?:\/\/\S+|^Permanent\b[\s:(,\u2013-]+\S/;

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * @param {{ markers: {file:string,line:number,issue:string|null}[], ledgerText: string, lockDeviationIds: string[] }} input
 * @returns {string[]} problems, empty when the ledger and the markers agree
 */
export function checkShims({ markers, ledgerText, lockDeviationIds }) {
  const problems = [];
  const tables = parseLedger(ledgerText).filter((t) => CHECKED_SECTIONS.some((s) => inSection(t, s)));

  // 4 and 5: "Removed by" on every row of the checked sections.
  const mainSeen = new Set();
  for (const t of tables) {
    const isMain = t.sub === null && !mainSeen.has(t.section);
    if (t.sub === null) mainSeen.add(t.section);
    const col = t.header[t.header.length - 1];
    for (const row of t.rows) {
      const name = row.cells[0] ?? '';
      if (/^_none yet_$/i.test(name)) continue;
      const where = `${LEDGER}:${row.line} (${t.section}${t.sub ? ` / ${t.sub}` : ''}) \`${name.replace(/`/g, '').slice(0, 50)}\``;
      if (row.cells.length < t.header.length) {
        problems.push(`${where}: ${row.cells.length} cells, the header has ${t.header.length}`);
        continue;
      }
      const removed = row.cells[row.cells.length - 1];
      if (!removed) problems.push(`${where}: empty "${col}"`);
      else if (isMain && !REMOVED_FORM.test(removed)) {
        problems.push(
          `${where}: "${col}" must name an issue or pull request (#83, EnterpriseAppBase#1216), a URL, or start with "Permanent" and a reason`,
        );
      }
    }
  }

  // 1: malformed markers.
  for (const m of markers) {
    if (m.issue === null) problems.push(`${m.file}:${m.line}: malformed marker, write ${MARKER_WORD}(#<issue>)`);
  }

  // 2 and 3: the "Code shims" table against the markers.
  const shimTables = tables.filter((t) => inSection(t, 'Code shims') && t.sub === null);
  const markerFiles = new Set(markers.map((m) => m.file));
  const named = [];
  for (const t of shimTables) {
    const whereCol = t.header.findIndex((h) => /^where$/i.test(h));
    if (whereCol === -1) {
      problems.push(`${LEDGER}: the "Code shims" table has no "Where" column`);
      continue;
    }
    for (const row of t.rows) {
      const tokens = backticks(row.cells[whereCol] ?? '')
        .map(pathToken)
        .filter(Boolean);
      if (tokens.length === 0) {
        problems.push(`${LEDGER}:${row.line}: row \`${(row.cells[0] ?? '').replace(/`/g, '').slice(0, 50)}\` names no file in "Where"`);
      }
      for (const tok of tokens) {
        named.push(tok);
        const hasMarker = tok.endsWith('/')
          ? [...markerFiles].some((f) => f.startsWith(tok))
          : markerFiles.has(tok);
        if (!hasMarker) problems.push(`${LEDGER}:${row.line}: "${tok}" carries no ${MARKER_WORD} marker (resolved? delete the row)`);
      }
    }
  }
  for (const file of [...markerFiles].sort()) {
    const covered = named.some((tok) => (tok.endsWith('/') ? file.startsWith(tok) : tok === file));
    if (!covered) problems.push(`${file}: has a ${MARKER_WORD} marker but no row in "Code shims" of ${LEDGER} names it`);
  }

  // 6: platform.lock deviations against "Database deviations".
  const dbTables = tables.filter((t) => inSection(t, 'Database deviations') && t.sub === null);
  const rowIds = new Set();
  for (const t of dbTables) for (const row of t.rows) for (const id of backticks(row.cells[0] ?? '')) rowIds.add(id);
  for (const id of lockDeviationIds) {
    if (!rowIds.has(id)) problems.push(`${LOCK}: deviation "${id}" has no row in "Database deviations" of ${LEDGER}`);
  }
  for (const id of rowIds) {
    if (!lockDeviationIds.includes(id)) problems.push(`${LEDGER}: "Database deviations" names "${id}", which ${LOCK} does not declare`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Reads the repository under `root` and runs the check. */
export function checkRepo(root) {
  const ledgerPath = join(root, LEDGER);
  if (!existsSync(ledgerPath)) return { problems: [`${LEDGER} is missing`], markers: [] };
  const lockPath = join(root, LOCK);
  let lockDeviationIds = [];
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lockDeviationIds = (lock.deviations ?? []).map((d) => d.id);
  }
  const markers = collectMarkers(root);
  const problems = checkShims({ markers, ledgerText: readFileSync(ledgerPath, 'utf8'), lockDeviationIds });
  return { problems, markers };
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[(i += 1)]);
    else {
      console.error('usage: check-shims.mjs [--root <dir>]');
      return 2;
    }
  }
  const { problems, markers } = checkRepo(root);
  if (problems.length > 0) {
    console.error(`check-shims: ${LEDGER} and the shim markers disagree:`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`check-shims: ${markers.length} marker(s), ledger rows and platform.lock deviations agree.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
