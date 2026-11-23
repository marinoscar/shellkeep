import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Base-to-domain boundary guard (issue #44).
 *
 * The base modules (platform, health, settings, storage, common, config,
 * prisma) must not know the terminal
 * domain: no import from `server-profiles/` or `terminal/`, no `servers:` or
 * `sessions:` permission string, no mention of `terminal`. The domain reaches
 * the base through registries (`settings/registry`, `app-registrations`).
 *
 * `app.module.ts`, `main.ts`, `shellkeep.manifest.ts` and `app-registrations/`
 * are the composition root and are not scanned.
 *
 * The allowlist is empty and must stay empty: move the code, do not allow it.
 */
const SRC = join(__dirname, '../../src');

const BASE_DIRS = [
  // The platform bindings (identity, host ports, Doctor); the identity slice itself
  // is the package's since #47 (the forked auth, users, allowlist, device-auth and
  // test-auth modules are deleted).
  'platform',
  'health',
  'settings',
  'storage',
  'common',
  'config',
  'prisma',
];

/** Paths relative to `src/` (posix separators) exempt from the scan. */
const ALLOWLIST: readonly string[] = [];

const DOMAIN_IMPORT =
  /(?:from|import|require\(|import\()\s*['"][^'"]*\/(?:server-profiles|terminal)(?:\/[^'"]*)?['"]/;
const DOMAIN_PERMISSION = /['"`](?:servers|sessions):/;
const DOMAIN_WORD = /terminal/i;

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function violationsIn(file: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (DOMAIN_IMPORT.test(line)) found.push(`${where} imports a domain module: ${line.trim()}`);
    if (DOMAIN_PERMISSION.test(line)) found.push(`${where} names a domain permission: ${line.trim()}`);
    if (DOMAIN_WORD.test(line)) found.push(`${where} mentions the terminal domain: ${line.trim()}`);
  });
  return found;
}

describe('base-domain boundary', () => {
  const files = BASE_DIRS.flatMap((d) => listTs(join(SRC, d)))
    .map((f) => ({ full: f, rel: relative(SRC, f).split(sep).join('/') }))
    .filter((f) => !ALLOWLIST.includes(f.rel));

  it('scans the base directories', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('keeps the allowlist empty', () => {
    expect(ALLOWLIST).toEqual([]);
  });

  it('has no base file that imports or names the domain', () => {
    const violations = files.flatMap((f) => violationsIn(f.rel, readFileSync(f.full, 'utf8')));
    expect(violations).toEqual([]);
  });

  describe('detection', () => {
    it.each([
      ["import { X } from '../terminal/terminal.module';"],
      ["import { X } from '../../server-profiles/server-profiles.service';"],
      ["const x = require('../terminal/ssh.service');"],
      ["@Auth({ permissions: ['servers:read'] })"],
      ['const p = "sessions:write";'],
      ['const t = terminalSettings;'],
    ])('flags %s', (line) => {
      expect(violationsIn('x.ts', line)).not.toEqual([]);
    });

    it.each([
      ["import { Y } from '../common/registry/define-registry';"],
      ['  sessions: [],'],
    ])('ignores %s', (line) => {
      expect(violationsIn('x.ts', line)).toEqual([]);
    });
  });
});
