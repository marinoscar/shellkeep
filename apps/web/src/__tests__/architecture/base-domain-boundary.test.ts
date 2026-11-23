import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

/**
 * Base-to-domain boundary guard, web half (issue #44; the API half is
 * apps/api/test/architecture/base-domain-boundary.spec.ts).
 *
 * The base web modules (components/{common,navigation,settings,admin},
 * contexts, identity, services/api.ts) must not know the terminal domain: no import from
 * a domain module, no `servers:` or `sessions:` permission string, no mention
 * of `terminal`. The domain reaches the base through the registries in
 * `config/` (destinations, user settings panels).
 *
 * `App.tsx`, `main.tsx`, `config/` and `pages/` are the composition root and
 * are not scanned.
 *
 * The allowlist is empty and must stay empty: move the code, do not allow it.
 */
const SRC = join(__dirname, '..', '..');

/** Directories (recursive) and single files, relative to `src/`. */
const BASE_PATHS = [
  'components/common',
  'components/navigation',
  'components/settings',
  'components/admin',
  'contexts',
  // The identity slice's bindings (issue #47; `components/auth` was deleted with it).
  'identity',
  'services/api.ts',
];

/** Paths relative to `src/` (posix separators) exempt from the scan. */
const ALLOWLIST: readonly string[] = [];

const DOMAIN_MODULES = [
  'components/terminal',
  'components/server-profiles',
  'components/home',
  'hooks/useTerminal',
  'hooks/useSessions',
  'hooks/useServerProfiles',
  'hooks/useTouchScroll',
  'hooks/useKeyboardInset',
  'services/terminal-ws',
  'services/terminal-api',
  'types/terminal',
  'lib/terminal',
];

/** Module specifiers of imports, re-exports, dynamic imports and `vi.mock`s. */
const SPECIFIER = /(?:\bfrom|^\s*import|\bimport\(|\brequire\(|\bvi\.mock\()\s*['"]([^'"]+)['"]/g;

/** The `src/`-relative module a specifier names, or null for a package. */
function resolveSpecifier(fileRel: string, spec: string): string | null {
  if (spec.startsWith('@/')) return posix.normalize(spec.slice(2));
  if (spec.startsWith('.')) return posix.join(posix.dirname(fileRel), spec);
  return null;
}

function isDomainModule(target: string): boolean {
  return DOMAIN_MODULES.some(
    (m) => target === m || target.startsWith(`${m}/`) || target.startsWith(`${m}.`),
  );
}

function domainImportsIn(fileRel: string, line: string): string[] {
  return [...line.matchAll(SPECIFIER)]
    .map((m) => resolveSpecifier(fileRel, m[1]))
    .filter((t): t is string => t !== null && isDomainModule(t));
}

const DOMAIN_PERMISSION = /['"`](?:servers|sessions):/;
const DOMAIN_WORD = /terminal/i;

function listSources(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const out: string[] = [];
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function violationsIn(file: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    for (const target of domainImportsIn(file, line)) {
      found.push(`${where} imports the domain module ${target}: ${line.trim()}`);
    }
    if (DOMAIN_PERMISSION.test(line)) found.push(`${where} names a domain permission: ${line.trim()}`);
    if (DOMAIN_WORD.test(line)) found.push(`${where} mentions the terminal domain: ${line.trim()}`);
  });
  return found;
}

describe('base-domain boundary (web)', () => {
  const files = BASE_PATHS.flatMap((p) => listSources(join(SRC, p)))
    .map((f) => ({ full: f, rel: relative(SRC, f).split(sep).join('/') }))
    .filter((f) => !ALLOWLIST.includes(f.rel));

  it('scans the base modules', () => {
    const rels = files.map((f) => f.rel);
    expect(rels).toContain('services/api.ts');
    expect(rels).toContain('components/navigation/Sidebar.tsx');
    expect(rels).toContain('contexts/ThemeContext.tsx');
    expect(rels).toContain('identity/IdentityProviders.tsx');
    expect(files.length).toBeGreaterThan(15);
  });

  it('keeps the allowlist empty', () => {
    expect(ALLOWLIST).toEqual([]);
  });

  it('has no base file that imports or names the domain', () => {
    const violations = files.flatMap((f) => violationsIn(f.rel, readFileSync(f.full, 'utf8')));
    expect(violations).toEqual([]);
  });

  describe('detection', () => {
    /** Detection lines are checked as if they were in this base file. */
    const FAKE_BASE_FILE = 'components/navigation/Example.tsx';

    it.each([
      ["import { KeyShortcutsSettings } from '../terminal/settings/KeyShortcutsSettings';"],
      ["import { TerminalView } from '../../components/terminal/TerminalView';"],
      ["import { ServerProfileList } from '../server-profiles/ServerProfileList';"],
      ["import { SessionStatsBar } from '../home/SessionStatsBar';"],
      ["import { useSessions } from '../../hooks/useSessions';"],
      ["import { useServerProfiles } from '../../hooks/useServerProfiles';"],
      ["import { useTouchScroll } from '../../hooks/useTouchScroll';"],
      ["import { useKeyboardInset } from '../../hooks/useKeyboardInset';"],
      ["import { getSessions } from '../../services/terminal-api';"],
      ["import { TerminalWsClient } from '../../services/terminal-ws';"],
      ["export { getSessions } from '../../services/terminal-api';"],
      ["} from '../../services/terminal-api';"],
      ["import { useSessions } from '@/hooks/useSessions';"],
      ["import type { ServerProfile } from '../../types/terminal';"],
      ["const m = await import('../../components/server-profiles/ServerProfileForm');"],
      ["vi.mock('../../hooks/useServerProfiles', () => ({}));"],
      ["<RequirePermission permission=\"servers:read\">"],
      ["hasPermission('sessions:write')"],
      ['const label = `Terminal`;'],
    ])('flags %s', (line) => {
      expect(violationsIn(FAKE_BASE_FILE, line)).not.toEqual([]);
    });

    it.each([
      ["import { api } from '../../services/api';"],
      ["import { usePermissions } from '../../hooks/usePermissions';"],
      ["import { DESTINATIONS } from '../../config/destinations';"],
      ["import { useUserSettings } from '../../hooks/useUserSettings';"],
      ["import { Home as HomeIcon } from '@mui/icons-material';"],
      ["import { UserMenu } from './UserMenu';"],
      ['  sessions: [],'],
      ["const p = 'users:read';"],
    ])('ignores %s', (line) => {
      expect(violationsIn(FAKE_BASE_FILE, line)).toEqual([]);
    });
  });
});
