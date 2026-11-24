import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WS_AUTH_DENIED_REASONS } from '../src/terminal/telemetry/terminal.metrics';
import { REDACTION_KINDS } from '../src/command-safety/redact';
import { RUNBOOK_STEP_KINDS } from '../src/runbooks/schema/runbook-definition.schema';
import { RUN_STATUSES } from '../src/runbooks/engine/state-machine';

// =============================================================================
// Hand-written docs that restate a list the code owns are checked against it (#82)
// =============================================================================
//
// Each block of a doc below sits between `<!-- name:start -->` and `<!-- name:end -->`.
// The spec reads the block and compares it with the code, so a permission, a job type, a
// WebSocket reason, a redaction kind, a step kind or a run status cannot change without the
// doc changing in the same pull request.
// =============================================================================

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

function block(file: string, name: string): string {
  const text = read(file);
  const start = text.indexOf(`<!-- ${name}:start -->`);
  const end = text.indexOf(`<!-- ${name}:end -->`);
  if (start < 0 || end < start) throw new Error(`${file}: block "${name}" not found`);
  return text.slice(start, end);
}

/** The first backticked cell of every table row of a block. */
const firstCells = (text: string): string[] =>
  [...text.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);

const backticked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('docs restate the code correctly (#82)', () => {
  it('ARCHITECTURE.md permission matrix equals the generated catalog', () => {
    const catalog = JSON.parse(read('apps/api/prisma/catalog/permissions.json')) as {
      rolePermissions: Record<string, string[]>;
    };
    const roles = ['admin', 'org_admin', 'contributor', 'viewer'];
    const rows = block('docs/ARCHITECTURE.md', 'permission-matrix')
      .split('\n')
      .filter((line) => /^\|\s*`/.test(line));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      const permission = cells[1].replace(/`/g, '');
      roles.forEach((role, index) => {
        const documented = cells[2 + index] === 'yes';
        expect({ permission, role, held: documented }).toEqual({
          permission,
          role,
          held: catalog.rolePermissions[role].includes(permission),
        });
      });
    }

    // Every domain permission the catalog holds is in the table.
    const documented = new Set(rows.map((r) => r.split('|')[1].trim().replace(/`/g, '')));
    const domain = Object.values(catalog.rolePermissions)
      .flat()
      .filter((p) => /^(servers|sessions|runbooks|ai):/.test(p));
    for (const permission of new Set(domain)) expect(documented.has(permission)).toBe(true);
  });

  it('ARCHITECTURE.md job-type table equals job-type-snapshot.spec.ts', () => {
    const snapshot = read('apps/api/test/jobs/job-type-snapshot.spec.ts');
    const registered = [...snapshot.matchAll(/^\s+'([a-z_.-]+\.[a-z_.-]+)':\s*'/gm)].map((m) => m[1]);
    const unlabelled = [...(snapshot.match(/UNLABELLED_JOB_TYPES: readonly string\[\] = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    const documented = firstCells(block('docs/ARCHITECTURE.md', 'job-types'));

    expect(registered.length).toBeGreaterThan(40);
    expect([...documented].sort()).toEqual([...registered, ...unlabelled].sort());
  });

  it('specs/terminal.md metric reasons equal WS_AUTH_DENIED_REASONS', () => {
    const documented = firstCells(block('docs/specs/terminal.md', 'ws-reasons'));
    expect([...documented].sort()).toEqual([...WS_AUTH_DENIED_REASONS].sort());
  });

  it('specs/terminal-ai.md redaction kinds equal REDACTION_KINDS', () => {
    const documented = backticked(block('docs/specs/terminal-ai.md', 'redaction-kinds'));
    expect([...documented].sort()).toEqual([...REDACTION_KINDS].sort());
  });

  it('specs/fleet-runbooks.md step kinds and run statuses equal the code', () => {
    const kinds = firstCells(block('docs/specs/fleet-runbooks.md', 'step-kinds'));
    expect([...kinds].sort()).toEqual([...RUNBOOK_STEP_KINDS].sort());

    const statuses = backticked(block('docs/specs/fleet-runbooks.md', 'run-statuses'));
    expect([...statuses].sort()).toEqual([...RUN_STATUSES].sort());
  });

  it('the gateway still sends every auth_fail wire reason the spec lists', () => {
    const gateway = read('apps/api/src/terminal/terminal.gateway.ts');
    const spec = read('docs/specs/terminal.md');
    for (const reason of ['Authentication timeout', 'Invalid token', 'Invalid user', 'Not authenticated']) {
      expect(gateway).toContain(`'${reason}'`);
      expect(spec).toContain(reason);
    }
    for (const frame of ['auth_ok', 'auth_refreshed', 'auth_fail', 'auth_expired', 'session_ready', 'session_error', 'pong']) {
      expect(gateway).toContain(`'${frame}'`);
      expect(spec).toContain(`\`${frame}\``);
    }
    for (const code of ['NOT_FOUND', 'TERMINATED', 'ATTACH_FAILED', 'CONNECTION_FAILED']) {
      expect(gateway).toContain(`'${code}'`);
      expect(spec).toContain(`\`${code}\``);
    }
  });
});
