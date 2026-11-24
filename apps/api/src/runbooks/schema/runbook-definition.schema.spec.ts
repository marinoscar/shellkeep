import { definitionSha256 } from './definition-hash';
import { definitionWarnings } from './definition-warnings';
import { runbookDefinitionSchema, type RunbookDefinitionInput } from './runbook-definition.schema';

const UUID = '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b';

type Step = RunbookDefinitionInput['steps'][number];

const STEP_FIXTURES: Record<string, Step> = {
  command: { id: 'c1', name: 'Disk usage', kind: 'command', command: 'df -h', workdir: '/var/log' },
  script: { id: 's1', name: 'Check', kind: 'script', interpreter: 'python3', body: 'print(1)', args: ['--x'] },
  package_update: { id: 'p1', name: 'Update', kind: 'package_update', packages: ['curl', 'openssl=3.0.2'], runAs: { sudo: true } },
  file_upload: { id: 'f1', name: 'Upload', kind: 'file_upload', storageObjectId: UUID, destPath: '/etc/app/app.conf', mode: '0640', owner: 'app:app' },
  collect_logs: { id: 'l1', name: 'Logs', kind: 'collect_logs', paths: ['/var/log/syslog'], journalUnits: ['sshd.service'], since: '24h' },
  ai_task: { id: 'a1', name: 'Investigate', kind: 'ai_task', goal: 'Find out why the disk is full', approvalMode: 'per_command' },
  approval_gate: { id: 'g1', name: 'Go?', kind: 'approval_gate', message: 'Proceed?' },
};

const def = (steps: Step[], extra: Record<string, unknown> = {}): unknown => ({ schemaVersion: 1, steps, ...extra });

function issuesOf(input: unknown): { path: string; message: string }[] {
  const result = runbookDefinitionSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('runbookDefinitionSchema', () => {
  describe.each(Object.entries(STEP_FIXTURES))('a %s step', (_kind, step) => {
    it('is valid and gets its defaults', () => {
      const parsed = runbookDefinitionSchema.parse(def([step]));
      expect(parsed.steps[0]).toMatchObject({ id: step.id, kind: step.kind, when: 'on_success', continueOnError: false, timeoutSec: 600 });
      expect(parsed.strategy).toEqual({ concurrency: 5, maxFailures: { count: 0 }, abortInFlight: false, pauseAfterFirstBatch: false });
      expect(parsed.defaultTargets).toEqual({ serverIds: [], tags: { any: [], all: [] }, groupIds: [], exclude: [] });
    });
  });

  it('defaults runAs and exit codes on a command', () => {
    const parsed = runbookDefinitionSchema.parse(def([STEP_FIXTURES.command]));
    expect(parsed.steps[0]).toMatchObject({ runAs: { sudo: false }, successExitCodes: [0] });
  });

  it('accepts every parameter type, a selector and a strategy', () => {
    const input = def([STEP_FIXTURES.command], {
      parameters: [
        { name: 'REGION', type: 'enum', options: ['eu', 'us'], default: 'eu' },
        { name: 'COUNT', type: 'number', default: 3 },
        { name: 'VERBOSE', type: 'boolean', default: false },
        { name: 'LABEL', type: 'string', pattern: '^[a-z]+$' },
        { name: 'API_TOKEN', type: 'secret', required: true },
      ],
      defaultTargets: { tags: { any: ['web'] }, exclude: [UUID] },
      strategy: { concurrency: 2, batchSize: 10, maxFailures: { percent: 20 }, pauseAfterFirstBatch: true },
    });
    expect(issuesOf(input)).toEqual([]);
  });

  describe('rejects', () => {
    it('duplicate step ids', () => {
      const issues = issuesOf(def([STEP_FIXTURES.command, { ...STEP_FIXTURES.script, id: 'c1' }]));
      expect(issues).toEqual([expect.objectContaining({ path: 'steps.1.id', message: expect.stringContaining('Duplicate step id') })]);
    });

    it('duplicate parameter names', () => {
      const issues = issuesOf(def([STEP_FIXTURES.command], { parameters: [{ name: 'A', type: 'string' }, { name: 'A', type: 'number' }] }));
      expect(issues.map((i) => i.path)).toContain('parameters.1.name');
    });

    it('an enum parameter without options', () => {
      expect(issuesOf(def([STEP_FIXTURES.command], { parameters: [{ name: 'A', type: 'enum' }] })).map((i) => i.path)).toContain('parameters.0.options');
    });

    it('a default that is not one of the options, or of the wrong type', () => {
      const bad = [
        { name: 'A', type: 'enum', options: ['x'], default: 'y' },
        { name: 'B', type: 'number', default: 'three' },
      ];
      expect(issuesOf(def([STEP_FIXTURES.command], { parameters: bad })).map((i) => i.path)).toEqual(['parameters.0.default', 'parameters.1.default']);
    });

    it('a secret parameter with a default', () => {
      const issues = issuesOf(def([STEP_FIXTURES.command], { parameters: [{ name: 'TOKEN', type: 'secret', default: 'hunter2' }] }));
      expect(issues).toEqual([expect.objectContaining({ path: 'parameters.0.default' })]);
    });

    it('autonomous mode with no allow pattern', () => {
      const step = { ...STEP_FIXTURES.ai_task, approvalMode: 'autonomous_within_allowlist' } as Step;
      expect(issuesOf(def([step]))).toEqual([expect.objectContaining({ path: 'steps.0.allow' })]);
    });

    it.each(['(unclosed', '(?=lookahead)x', '(a)\\1'])('the invalid RE2 pattern %s in allow, deny and a parameter', (pattern) => {
      const ai = { ...STEP_FIXTURES.ai_task, approvalMode: 'per_command', allow: [pattern], deny: ['ok', pattern] } as Step;
      const paths = issuesOf(def([ai], { parameters: [{ name: 'P', type: 'string', pattern }] })).map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['steps.0.allow.0', 'steps.0.deny.1', 'parameters.0.pattern']));
      expect(paths).not.toContain('steps.0.deny.0');
    });

    it('a pattern on a non-string parameter', () => {
      expect(issuesOf(def([STEP_FIXTURES.command], { parameters: [{ name: 'N', type: 'number', pattern: '^1$' }] })).map((i) => i.path)).toContain('parameters.0.pattern');
    });

    it.each([
      ['workdir', { ...STEP_FIXTURES.command, workdir: '/var/../etc' }, 'steps.0.workdir'],
      ['destPath', { ...STEP_FIXTURES.file_upload, destPath: '/etc/../root/x' }, 'steps.0.destPath'],
      ['log path', { ...STEP_FIXTURES.collect_logs, paths: ['/var/log/../../etc/shadow'] }, 'steps.0.paths.0'],
      ['relative path', { ...STEP_FIXTURES.command, workdir: 'relative/dir' }, 'steps.0.workdir'],
    ])('a bad %s', (_name, step, path) => {
      expect(issuesOf(def([step as Step])).map((i) => i.path)).toContain(path);
    });

    it('a segment over the 14,400 second budget, but not one split by a pause point', () => {
      const long = (id: string): Step => ({ ...STEP_FIXTURES.command, id, timeoutSec: 7_200 }) as Step;
      const over = issuesOf(def([long('a'), long('b'), long('c')]));
      expect(over).toEqual([expect.objectContaining({ path: 'steps.2.timeoutSec' })]);

      expect(issuesOf(def([long('a'), long('b'), STEP_FIXTURES.approval_gate, long('c'), long('d')]))).toEqual([]);
      expect(issuesOf(def([long('a'), long('b'), { ...STEP_FIXTURES.ai_task, id: 'ai' } as Step, long('c')]))).toEqual([]);
    });

    it('collect_logs with neither paths nor journal units', () => {
      const step = { id: 'l', name: 'Logs', kind: 'collect_logs' } as Step;
      expect(issuesOf(def([step]))).toEqual([expect.objectContaining({ path: 'steps.0.paths' })]);
    });

    it('an unknown kind, a bad step id, no steps and a wrong schema version', () => {
      expect(issuesOf(def([{ id: 'x', name: 'x', kind: 'teleport' } as unknown as Step])).length).toBeGreaterThan(0);
      expect(issuesOf(def([{ ...STEP_FIXTURES.command, id: 'Bad Id' }])).map((i) => i.path)).toContain('steps.0.id');
      expect(issuesOf(def([])).map((i) => i.path)).toContain('steps');
      expect(issuesOf({ schemaVersion: 2, steps: [STEP_FIXTURES.command] }).map((i) => i.path)).toContain('schemaVersion');
    });

    it('a bad parameter name', () => {
      expect(issuesOf(def([STEP_FIXTURES.command], { parameters: [{ name: 'lower', type: 'string' }] })).map((i) => i.path)).toContain('parameters.0.name');
    });
  });
});

describe('definitionSha256', () => {
  const parse = (value: unknown) => runbookDefinitionSchema.parse(value);

  it('ignores key order and is stable across a parse of its own output', () => {
    const a = parse(def([STEP_FIXTURES.command]));
    const reordered = parse({ steps: [{ kind: 'command', command: 'df -h', name: 'Disk usage', id: 'c1', workdir: '/var/log' }], schemaVersion: 1 });
    expect(definitionSha256(a)).toBe(definitionSha256(reordered));
    expect(definitionSha256(parse(a))).toBe(definitionSha256(a));
    expect(definitionSha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the definition does', () => {
    const a = parse(def([STEP_FIXTURES.command]));
    const b = parse(def([{ ...STEP_FIXTURES.command, command: 'df -i' } as Step]));
    expect(definitionSha256(a)).not.toBe(definitionSha256(b));
  });
});

describe('definitionWarnings', () => {
  it('flags a first step that can never run, autonomous AI without deny, and no default targets', () => {
    const ai = { ...STEP_FIXTURES.ai_task, approvalMode: 'autonomous_within_allowlist', allow: ['^ls '] } as Step;
    const parsed = runbookDefinitionSchema.parse(def([{ ...STEP_FIXTURES.command, when: 'on_failure' } as Step, ai]));
    expect(definitionWarnings(parsed).map((w) => w.code)).toEqual(['FIRST_STEP_ON_FAILURE', 'AI_AUTONOMOUS_WITHOUT_DENY', 'NO_DEFAULT_TARGETS']);
  });

  it('is empty for a clean definition', () => {
    const parsed = runbookDefinitionSchema.parse(def([STEP_FIXTURES.command], { defaultTargets: { serverIds: [UUID] } }));
    expect(definitionWarnings(parsed)).toEqual([]);
  });
});
