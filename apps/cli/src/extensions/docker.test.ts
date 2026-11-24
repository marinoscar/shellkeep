import { describe, expect, it } from 'vitest';

import { type DockerRun, execInContainer, findApiContainer } from './docker.js';

const ok = (stdout = ''): Awaited<ReturnType<DockerRun>> => ({ exitCode: 0, stdout, stderr: '', unavailable: false });

describe('findApiContainer', () => {
  it('asks for the running api service of the named compose project', async () => {
    const asked: string[][] = [];
    const run: DockerRun = async (args) => {
      asked.push([...args]);
      return ok('abc123\n');
    };

    const found = await findApiContainer({ deployRoot: '/nowhere', composeProject: 'shellkeep' }, run);

    expect(found).toEqual({ kind: 'found', id: 'abc123', project: 'shellkeep' });
    expect(asked[0]).toEqual([
      'ps',
      '--filter',
      'label=com.docker.compose.project=shellkeep',
      '--filter',
      'label=com.docker.compose.service=api',
      '--filter',
      'status=running',
      '--quiet',
    ]);
  });

  it('is "none" when no api container runs, and "unavailable" when docker cannot be asked', async () => {
    expect((await findApiContainer({ deployRoot: '/nowhere', composeProject: 'p' }, async () => ok(''))).kind).toBe('none');
    expect(
      (await findApiContainer({ deployRoot: '/nowhere', composeProject: 'p' }, async () => ({ exitCode: null, stdout: '', stderr: '', unavailable: true }))).kind,
    ).toBe('unavailable');
  });
});

describe('execInContainer', () => {
  it('runs the argv in the api workdir, as argv and never a shell string', async () => {
    const asked: string[][] = [];
    await execInContainer('abc123', ['tmux', '-V'], 1000, async (args) => {
      asked.push([...args]);
      return ok();
    });

    expect(asked).toEqual([['exec', '--workdir', '/app/apps/api', 'abc123', 'tmux', '-V']]);
  });
});
