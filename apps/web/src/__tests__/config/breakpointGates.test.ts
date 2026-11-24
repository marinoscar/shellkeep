import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * The five coupled breakpoint gates are the PLATFORM's (#76):
 *
 *   1. `ShellLayout` `showRail`            `up('sm')`
 *   2. `ShellBottomNav` self-gate          `down('sm')`
 *   3. `<main>` `pb: { xs: 10, sm: 3 }`    (in `ShellLayout`)
 *   4. `SettingsHub` `isCompactWindow`     `down('sm')`
 *   5. `ShellAppBar` `isCompactWindow`     `down('sm')`
 *
 * all inside `@marinoscar/platform-web`, which this repository does not edit.
 * What it CAN do is refuse to grow a sixth read in the chrome it binds. This
 * suite scans `src/` for the two ways a component reads a breakpoint,
 * `useMediaQuery(` and `theme.breakpoints.up|down(`, and fails on any file not
 * listed below with a reason. Adding a read is allowed; adding it WITHOUT
 * writing down why it is not a gate is not. The boundary is `sm` (600px),
 * never `md` (Settings UI Pattern rule 5, root AGENTS.md).
 *
 * A text scan, not a parser: comments are stripped first so prose that names
 * `useMediaQuery(` does not count. Copied from KVox's guard of the same name.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const BREAKPOINT_READ = /\buseMediaQuery\s*\(|\bbreakpoints\.(?:up|down|between|only)\s*\(/;

/** Why a file may read a breakpoint without being one of the five gates. */
const WHY = {
  page: 'a page picks its own compact layout for its body; it is page content, not navigation chrome',
  terminal:
    'a terminal control (toolbar, key bar, scroll buttons) picks its own compact layout inside the session page; it mounts no navigation',
  dialog: 'a dialog or sheet goes full-screen below sm; it is page content, not navigation chrome',
} as const;

/**
 * Every file under `src/` (outside tests) that reads a breakpoint, keyed by its
 * path from `src/`. NONE of them may be shell chrome (see `CHROME` below).
 */
const ALLOWED_READS: Readonly<Record<string, string>> = {};

/**
 * The files that ARE this app's shell chrome and its bindings. They must read
 * no breakpoint at all: the shell, its settings hub and its themes are the
 * platform's.
 */
const CHROME = [
  'App.tsx',
  'main.tsx',
  'components/common/Layout.tsx',
  'config/shell.ts',
  'config/destinations.ts',
  'config/adminSections.tsx',
  'config/userSettingsSections.tsx',
  'pages/UserSettingsHubPage.tsx',
  'pages/AdminSettingsHubPage.tsx',
  'platform/platformHost.tsx',
  'platform/shellTheme.ts',
];

/** Block and line comments removed (a line comment must not follow `:` or a quote, so URLs survive). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function isTestFile(path: string): boolean {
  const parts = path.split(sep);
  return parts.includes('__tests__') || /\.(test|spec)\.(ts|tsx)$/.test(path) || parts.includes('mocks');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !isTestFile(full) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC);
const keyOf = (file: string) => relative(SRC, file).split(sep).join('/');
const READERS = FILES.filter((file) => BREAKPOINT_READ.test(stripComments(readFileSync(file, 'utf8')))).map(keyOf);

describe('breakpoint gates: the five are the platform shell\'s (#76)', () => {
  it('scans the source tree (guards the scan itself against matching nothing)', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.map(keyOf)).toContain('components/common/Layout.tsx');
  });

  it('detects a breakpoint read, and ignores one in a comment', () => {
    expect(BREAKPOINT_READ.test(stripComments('const c = useMediaQuery(theme.breakpoints.down("sm"));'))).toBe(true);
    expect(BREAKPOINT_READ.test(stripComments('const c = theme.breakpoints.up("sm") ? 1 : 0;'))).toBe(true);
    expect(BREAKPOINT_READ.test(stripComments('// useMediaQuery(theme.breakpoints.down("sm"))'))).toBe(false);
    expect(BREAKPOINT_READ.test(stripComments('/* breakpoints.up("sm") */ const x = 1;'))).toBe(false);
  });

  it('every file that reads a breakpoint is listed with a reason', () => {
    const unlisted = READERS.filter((file) => !(file in ALLOWED_READS));
    expect(
      unlisted,
      'These files read a breakpoint (useMediaQuery or theme.breakpoints.up/down) and are not ' +
        'listed in ALLOWED_READS. The five coupled gates live in @marinoscar/platform-web ' +
        '(ShellLayout, ShellBottomNav, SettingsHub, ShellAppBar); a new read is a page-level ' +
        'choice that must say why it is not a sixth gate.',
    ).toEqual([]);
  });

  it('lists no file that has stopped reading a breakpoint (the allowlist stays honest)', () => {
    const stale = Object.keys(ALLOWED_READS).filter((file) => !READERS.includes(file));
    expect(stale, 'Remove these from ALLOWED_READS: they read no breakpoint any more').toEqual([]);
  });

  it('gives every listed read a reason drawn from WHY', () => {
    for (const [file, reason] of Object.entries(ALLOWED_READS)) {
      expect(Object.values(WHY), `${file} needs a reason from WHY`).toContain(reason);
    }
  });

  describe('shell chrome and its bindings read no breakpoint', () => {
    it.each(CHROME)('%s', (file) => {
      expect(existsSync(join(SRC, file)), `${file} must exist`).toBe(true);
      expect(READERS).not.toContain(file);
      expect(Object.keys(ALLOWED_READS)).not.toContain(file);
    });
  });

  it('keeps the deleted app-side shell files deleted', () => {
    // A re-added copy would bring a second set of gates back.
    for (const gone of [
      // The forked app bar, sidebar and user menu, the theme context and the
      // hand-built themes: whole folders, so no copy can come back inside them.
      'components/navigation',
      'contexts',
      'theme',
      'pages/TerminalFullPage.tsx',
    ]) {
      expect(existsSync(join(SRC, gone)), `${gone} must stay deleted`).toBe(false);
    }
  });
});
