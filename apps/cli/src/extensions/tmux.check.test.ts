import { describe, expect, it } from 'vitest';

import type { DockerRun, DockerRunResult } from './docker.js';
import { TMUX_CHECK_ID, createTmuxCheck } from './tmux.check.js';

const CONTEXT = {
  deployRoot: '/opt/infra/apps/example',
  bindPort: 8323,
  composeProject: 'example',
  proxyRoot: '/opt/infra/proxy',
  domain: undefined,
  env: undefined,
  skipProxy: false,
} as const;

const result = (overrides: Partial<DockerRunResult>): DockerRunResult => ({ exitCode: 0, stdout: '', stderr: '', unavailable: false, ...overrides });

/** psOutput answers `docker ps`; exec answers the `tmux -V`. */
function docker(psOutput: string, exec: DockerRunResult): { run: DockerRun; asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    run: async (args) => {
      asked.push([...args]);
      return args[0] === 'ps' ? result({ stdout: psOutput }) : exec;
    },
  };
}

describe('the tmux-on-api-image check', () => {
  it('passes with the version when tmux -V runs in the api container', async () => {
    const { run, asked } = docker('abc\n', result({ stdout: 'tmux 3.4\n' }));

    expect(await createTmuxCheck(run).run(CONTEXT)).toEqual({ status: 'pass', detail: 'tmux 3.4' });
    expect(asked.at(-1)).toEqual(['exec', '--workdir', '/app/apps/api', 'abc', 'tmux', '-V']);
  });

  it('fails, with the image remedy, when tmux -V does not run', async () => {
    const { run } = docker('abc\n', result({ exitCode: 127, stderr: 'executable file not found' }));

    const outcome = await createTmuxCheck(run).run(CONTEXT);

    expect(outcome.status).toBe('fail');
    expect(outcome.remedy).toContain('tmux');
  });

  it('skips when there is no running api container yet (a first install)', async () => {
    const { run } = docker('', result({}));

    expect((await createTmuxCheck(run).run(CONTEXT)).status).toBe('skip');
  });

  it('skips, never fails, when docker cannot be asked', async () => {
    const { run } = docker('abc\n', result({ exitCode: null, unavailable: true }));

    expect((await createTmuxCheck(run).run(CONTEXT)).status).toBe('skip');
  });

  it('is a recommended check after the docker-daemon check', () => {
    const check = createTmuxCheck();
    expect(check.id).toBe(TMUX_CHECK_ID);
    expect(check.id).toBe('tmux-on-api-image');
    expect(check.severity).toBe('recommended');
    expect(check.requires).toEqual(['docker-daemon']);
  });
});
