import { classifyCommand } from '../../command-safety';
import { runbookDefinitionSchema, type RunbookDefinitionInput } from '../schema/runbook-definition.schema';
import { AI_AUTONOMOUS_REASON, assessDefinition } from './runbook-risk.service';

const OBJECT_ID = '11111111-1111-4111-8111-111111111111';
const def = (steps: unknown[]) => runbookDefinitionSchema.parse({ schemaVersion: 1, steps } as RunbookDefinitionInput);
const cmd = (command: string) => ({ id: 's1', name: 's1', kind: 'command', command });

describe('destructive table: runbook rows (#67)', () => {
  it.each([
    ['rm_unquoted_variable', 'rm -rf $X/'],
    ['rm_unquoted_variable', 'rm -rf ${X}/*'],
    ['rm_unquoted_variable', 'rm -rf $DIR'],
    ['rm_unquoted_variable', 'sudo rm -fr -- ${DIR}/'],
    ['find_delete_root', 'find / -name "*.log" -delete'],
    ['find_delete_root', 'find / -mtime +1 -type f -delete'],
    ['truncate_var_lib', 'truncate -s 0 /var/lib/postgresql/data/x'],
    ['truncate_var_lib', 'truncate --size=0 /var/lib/app/db'],
  ])('%s: %s is destructive', (_id, command) => {
    expect(classifyCommand(command)).toMatchObject({ risk: 'high', destructive: true });
  });

  it('names the unset variable in the reason', () => {
    expect(classifyCommand('rm -rf $X/').reasons.join(' ')).toMatch(/unset variable expands to \//);
  });

  it.each([
    'rm -rf $X/build',
    'rm -rf ${X:?unset}/',
    'rm -rf ./build/',
    'find /var/tmp -mtime +7 -delete',
    'find . -name x -delete',
    'find / -name x -print',
  ])('look-alike %j is not destructive', (command) => {
    expect(classifyCommand(command).destructive).toBe(false);
  });

  it('the plain truncate command stays covered by the pre-existing sql_truncate row', () => {
    expect(classifyCommand('truncate -s 0 /var/log/app.log').destructive).toBe(true);
  });

  it('a quoted variable path is high but NOT destructive', () => {
    for (const command of ['rm -rf "$DIR/"', 'rm -rf "${DIR}/"*', 'rm -rf "$DIR"/*', 'rm -rf -- "$DIR/"']) {
      expect(classifyCommand(command)).toMatchObject({ risk: 'high', destructive: false });
    }
  });

  it('an unquoted variable path is destructive', () => {
    expect(classifyCommand('rm -rf $DIR/')).toMatchObject({ risk: 'high', destructive: true });
  });

  it('a quoted echo of the new patterns stays medium', () => {
    expect(classifyCommand('echo "rm -rf $X/"')).toMatchObject({ risk: 'medium', destructive: false });
  });
});

describe('assessDefinition', () => {
  it('a safe runbook has no findings', () => {
    expect(assessDefinition(def([cmd('echo hello')]))).toEqual({ destructive: false, risk: 'low', findings: [] });
  });

  it('classifies each line of a script body and reports the lines', () => {
    const risk = assessDefinition(def([{ id: 's1', name: 's1', kind: 'script', body: 'echo start\nrm -rf $BUILD/\necho done\nsudo ls' }]));
    expect(risk.destructive).toBe(true);
    expect(risk.risk).toBe('high');
    expect(risk.findings).toHaveLength(1);
    expect(risk.findings[0]).toMatchObject({ stepId: 's1', stepIndex: 0, kind: 'script', risk: 'high', destructive: true, lines: [2, 4] });
    expect(risk.findings[0]!.reasons.join(' ')).toMatch(/unset variable/);
  });

  it('a quoted variable path is high but the definition is not destructive', () => {
    const risk = assessDefinition(def([cmd('rm -rf "$DIR/"')]));
    expect(risk).toMatchObject({ destructive: false, risk: 'high' });
    expect(risk.findings[0]).toMatchObject({ risk: 'high', destructive: false });
  });

  it('package_update with all packages is medium; named packages are not a finding', () => {
    const all = assessDefinition(def([{ id: 'u', name: 'u', kind: 'package_update', packages: 'all' }]));
    expect(all).toMatchObject({ destructive: false, risk: 'medium' });
    expect(assessDefinition(def([{ id: 'u', name: 'u', kind: 'package_update', packages: ['curl'] }])).findings).toEqual([]);
  });

  it.each(['/etc/nginx/nginx.conf', '/boot/grub/grub.cfg', '/usr/local/bin/tool'])('file_upload to %s is medium, high with overwrite, never destructive', (destPath) => {
    const step = { id: 'f', name: 'f', kind: 'file_upload', storageObjectId: OBJECT_ID, destPath };
    expect(assessDefinition(def([step]))).toMatchObject({ destructive: false, risk: 'medium' });
    expect(assessDefinition(def([{ ...step, overwrite: true }]))).toMatchObject({ destructive: false, risk: 'high' });
  });

  it('file_upload elsewhere is not a finding', () => {
    expect(assessDefinition(def([{ id: 'f', name: 'f', kind: 'file_upload', storageObjectId: OBJECT_ID, destPath: '/srv/app/x', overwrite: true }])).findings).toEqual([]);
    expect(assessDefinition(def([{ id: 'f', name: 'f', kind: 'file_upload', storageObjectId: OBJECT_ID, destPath: '/etcetera/x' }])).findings).toEqual([]);
  });

  it('an autonomous ai_task is medium with the note; the other modes are not findings', () => {
    const step = { id: 'a', name: 'a', kind: 'ai_task', goal: 'tidy', allow: ['^ls'] };
    const autonomous = assessDefinition(def([{ ...step, approvalMode: 'autonomous_within_allowlist' }]));
    expect(autonomous).toMatchObject({ destructive: false, risk: 'medium' });
    expect(autonomous.findings[0]!.reasons).toEqual([AI_AUTONOMOUS_REASON]);
    expect(assessDefinition(def([{ ...step, approvalMode: 'per_command' }])).findings).toEqual([]);
  });

  it('never repeats the command text in a finding', () => {
    const text = JSON.stringify(assessDefinition(def([cmd('rm -rf $SECRET_DIR/ # token-abc123')])));
    expect(text).not.toContain('token-abc123');
    expect(text).not.toContain('SECRET_DIR');
  });
});
