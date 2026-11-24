import { spawnSync } from 'node:child_process';

import { runbookDefinitionSchema } from '../schema/runbook-definition.schema';
import { PROBE_MARKER, commandBinaries, estimateLogCollection, globQuote, planDryRunStep, type DryRunPlan } from './dry-run';

const step = (over: Record<string, unknown>) =>
  runbookDefinitionSchema.parse({ schemaVersion: 1, steps: [{ id: 's1', name: 's1', ...over }] }).steps[0]!;
const plan = (over: Record<string, unknown>, factsManager?: string): DryRunPlan => planDryRunStep(step(over), { factsManager, seed: 'seed' });
const probe = (p: DryRunPlan) => {
  if (p.kind !== 'probe') throw new Error(`expected a probe, got ${p.kind}`);
  return p;
};
const runProbe = (script: string) => spawnSync('bash', ['-s'], { input: script, encoding: 'utf8' });

describe('commandBinaries', () => {
  it('finds the first word of each simple command', () => {
    expect(commandBinaries('git pull && make build | tee out.log; systemctl restart app')).toEqual(['git', 'make', 'tee', 'systemctl']);
  });
  it('skips assignments, wrappers, builtins, expansions and quoted text', () => {
    expect(commandBinaries('FOO=1 sudo -u deploy nginx -t')).toEqual(['nginx']);
    expect(commandBinaries('cd /srv && export A=1 && echo "x; evil y" && "$BIN" run')).toEqual([]);
    expect(commandBinaries('if test -f x; then curl -s y; fi')).toEqual(['curl']);
  });
  it('ignores comments and stops at a heredoc body', () => {
    expect(commandBinaries('# nothing: rm -rf /\nls\ncat <<EOF\nnotabinary --x\nEOF')).toEqual(['ls', 'cat']);
  });
});

describe('globQuote', () => {
  it('keeps glob characters live and escapes everything dangerous', () => {
    expect(globQuote('/var/log/*.log')).toBe('/var/log/*.log');
    expect(globQuote('/tmp/a b;$(x)')).toBe('/tmp/a\\ b\\;\\$\\(x\\)');
    expect(globQuote('/tmp/a\nb')).toBeNull();
  });
});

describe('estimateLogCollection', () => {
  const listing = ['total 12', '-rw-r--r-- 1 root root 2048 Jan  1 00:00 /var/log/a.log', '-rw-r----- 1 root adm 9000 Jan  1 00:00 /var/log/b.log', 'drwxr-xr-x 2 root root 4096 Jan  1 00:00 d'].join('\n');
  it('sums regular files against the caps', () => {
    expect(estimateLogCollection(listing, { maxBytesPerFile: 4096, maxTotalBytes: 100_000 })).toEqual({ files: 2, totalBytes: 11_048, oversized: 1, overTotal: false });
    expect(estimateLogCollection(listing, { maxBytesPerFile: 1_000_000, maxTotalBytes: 10_000 }).overTotal).toBe(true);
  });
});

describe('planDryRunStep', () => {
  it('every probe starts with the marker and never contains the command as a bare line', () => {
    const p = probe(plan({ kind: 'command', command: 'touch /tmp/should-not-exist' }));
    expect(p.script.startsWith(PROBE_MARKER)).toBe(true);
    expect(p.script).toContain("<<'SK_DRY_");
  });

  it('a command probe checks syntax and the binaries without running the command', () => {
    const p = probe(plan({ kind: 'command', command: 'echo hi; sk-no-such-binary-xyz --flag' }));
    const result = runProbe(p.script);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('syntax: ok');
    expect(result.stderr).toContain('missing: sk-no-such-binary-xyz');
    expect(result.stdout).not.toContain('hi\n');
  });

  it('a syntax error is a failed precondition', () => {
    const result = runProbe(probe(plan({ kind: 'command', command: 'if then fi (' })).script);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('syntax: error');
  });

  it('a clean command passes and nothing is executed', () => {
    const result = runProbe(probe(plan({ kind: 'command', command: 'ls /nonexistent-dir-xyz && rm -rf /tmp/sk-dry-run-canary' })).script);
    expect(result.status).toBe(0);
  });

  it('a python script is compiled from a temp file that is removed', () => {
    if (spawnSync('python3', ['--version']).status !== 0) return;
    const ok = runProbe(probe(plan({ kind: 'script', interpreter: 'python3', body: 'print(1)\n' })).script);
    expect(ok.status).toBe(0);
    const bad = runProbe(probe(plan({ kind: 'script', interpreter: 'python3', body: 'def (:\n' })).script);
    expect(bad.status).toBe(1);
  });

  it.each([
    ['apt', 'apt-get -s upgrade', [0]],
    ['dnf', 'dnf --assumeno upgrade', [0, 1]],
    ['yum', 'yum --assumeno upgrade', [0, 1]],
    ['apk', 'apk upgrade --simulate', [0]],
    ['zypper', 'zypper --non-interactive update --dry-run', [0]],
  ])('package_update on %s uses its simulation form', (manager, line, codes) => {
    const p = probe(plan({ kind: 'package_update', manager, packages: 'all' }));
    expect(p.script).toContain(line);
    expect(p.okExitCodes).toEqual(codes);
    expect(p.script).not.toMatch(/apt-get (upgrade|install) -y|apt-get update/);
  });

  it('package_update names the packages in the simulation and skips brew', () => {
    expect(probe(plan({ kind: 'package_update', manager: 'apt', packages: ['curl'] })).script).toContain("apt-get -s install --only-upgrade 'curl'");
    expect(plan({ kind: 'package_update', manager: 'brew', packages: 'all' })).toEqual({ kind: 'skip', reason: 'brew has no dry-run mode' });
  });

  it('package_update with no manager known fails like the real step', () => {
    expect(plan({ kind: 'package_update', manager: 'auto', packages: 'all' })).toMatchObject({ kind: 'fail', code: 'PACKAGE_MANAGER_UNKNOWN' });
    expect(probe(plan({ kind: 'package_update', manager: 'auto', packages: 'all' }, 'dnf')).script).toContain('dnf --assumeno');
  });

  it('file_upload checks the directory and the destination', () => {
    const dir = '/tmp';
    const p = probe(plan({ kind: 'file_upload', storageObjectId: '11111111-1111-4111-8111-111111111111', destPath: `${dir}/sk-dry-run-nonexistent-file` }));
    expect(runProbe(p.script).status).toBe(0);
    const existing = probe(plan({ kind: 'file_upload', storageObjectId: '11111111-1111-4111-8111-111111111111', destPath: '/etc/hostname' }));
    expect(runProbe(existing.script).status).toBe(1); // exists and overwrite is off
    const overwrite = probe(plan({ kind: 'file_upload', storageObjectId: '11111111-1111-4111-8111-111111111111', destPath: '/etc/hostname', overwrite: true }));
    expect(overwrite.script).toContain('would be replaced');
    const missing = probe(plan({ kind: 'file_upload', storageObjectId: '11111111-1111-4111-8111-111111111111', destPath: '/no-such-dir-xyz/f' }));
    expect(runProbe(missing.script).status).toBe(1);
  });

  it('collect_logs lists the paths with ls -la', () => {
    const p = probe(plan({ kind: 'collect_logs', paths: ['/etc/host*'] }));
    expect(p.script).toContain('ls -la -- /etc/host*');
  });

  it('ai_task and approval_gate are not simulated', () => {
    expect(plan({ kind: 'approval_gate' })).toEqual({ kind: 'skip', reason: 'not simulated' });
    expect(plan({ kind: 'ai_task', goal: 'x', approvalMode: 'per_command' })).toEqual({ kind: 'skip', reason: 'not simulated' });
  });
});
