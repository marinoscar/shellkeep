// =============================================================================
// Snippets never reach logs or AI (issue #172)
// =============================================================================
//
// A snippet body may hold a credential the user pasted. Two static proofs, so a later edit cannot quietly
// break the rule:
//   1. nothing in `src/snippets/` writes to a logger, the console or a span (the audit helper is the one
//      allowed output, and the service spec pins what it carries);
//   2. nothing outside the module imports it, except the app module and the registrations, and no AI code
//      (`terminal-ai`, `platform/ai`, `app-registrations/ai.ts`) names a snippet.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('snippets stay out of logs and AI', () => {
  const own = files(join(SRC, 'snippets')).filter((f) => !f.endsWith('.spec.ts'));

  it('finds the module, so this cannot pass vacuously', () => {
    expect(own.length).toBeGreaterThanOrEqual(6);
  });

  it('writes nothing to a logger, the console or a span', () => {
    const offenders = own.filter((file) => /\b(?:logger|this\.logger|console)\.(?:log|warn|error|debug|verbose|info)\(|setAttribute\(|addEvent\(/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('is imported by nothing but the app module and the registrations', () => {
    const allowed = new Set(['app.module.ts', 'app-registrations/registrations.ts']);
    const importers = files(SRC)
      .filter((f) => !f.includes('/snippets/') && /from '(?:\.\.?\/)+snippets\//.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(importers.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it('is named by no AI code', () => {
    const ai = files(SRC).filter((f) => /terminal-ai|\/platform\/ai\/|app-registrations\/ai\.ts/.test(f));
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.filter((f) => /snippet/i.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f))).toEqual([]);
  });
});
