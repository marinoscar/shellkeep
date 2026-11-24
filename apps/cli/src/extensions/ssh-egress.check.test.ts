import { describe, expect, it } from 'vitest';

import type { DockerRun, DockerRunResult } from './docker.js';
import { SSH_EGRESS_CHECK_ID, createSshEgressCheck, parseEgressTarget } from './ssh-egress.check.js';

const values = (entries: Record<string, string>) => ({
  has: (key: string) => key in entries,
  get: (key: string) => entries[key],
  keys: () => Object.keys(entries),
});

const context = (env: Record<string, string> | undefined) =>
  ({
    deployRoot: '/opt/infra/apps/example',
    bindPort: 8323,
    composeProject: 'example',
    proxyRoot: '/opt/infra/proxy',
    domain: undefined,
    env: env === undefined ? undefined : values(env),
    skipProxy: false,
  }) as const;

const result = (overrides: Partial<DockerRunResult>): DockerRunResult => ({ exitCode: 0, stdout: '', stderr: '', unavailable: false, ...overrides });

function docker(exec: DockerRunResult): { run: DockerRun; asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    run: async (args) => {
      asked.push([...args]);
      return args[0] === 'ps' ? result({ stdout: 'abc\n' }) : exec;
    },
  };
}

describe('parseEgressTarget', () => {
  it('reads host and host:port, defaulting to 22', () => {
    expect(parseEgressTarget('ssh-test.example.test')).toEqual({ host: 'ssh-test.example.test', port: 22 });
    expect(parseEgressTarget('ssh-test.example.test:2222')).toEqual({ host: 'ssh-test.example.test', port: 2222 });
  });

  it('refuses anything that is not a host name with an optional port', () => {
    for (const bad of ['', 'host; rm -rf /', 'host:0', 'host:70000', '-host', 'a b', 'http://host']) {
      expect(parseEgressTarget(bad)).toBeUndefined();
    }
  });
});

describe('the ssh-egress check', () => {
  it('skips when no test host is configured, without touching docker', async () => {
    const { run, asked } = docker(result({}));

    expect((await createSshEgressCheck(run).run(context({}))).status).toBe('skip');
    expect((await createSshEgressCheck(run).run(context(undefined))).status).toBe('skip');
    expect((await createSshEgressCheck(run).run(context({ SSH_EGRESS_TEST_HOST: '  ' }))).status).toBe('skip');
    expect(asked).toEqual([]);
  });

  it('passes when the api container can open the connection, passing host and port as argv', async () => {
    const { run, asked } = docker(result({}));

    const outcome = await createSshEgressCheck(run).run(context({ SSH_EGRESS_TEST_HOST: 'ssh-test.example.test:2222' }));

    expect(outcome).toEqual({ status: 'pass', detail: 'ssh-test.example.test:2222 reachable' });
    const exec = asked.at(-1) as string[];
    expect(exec.slice(0, 4)).toEqual(['exec', '--workdir', '/app/apps/api', 'abc']);
    expect(exec.slice(-2)).toEqual(['ssh-test.example.test', '2222']);
    expect(exec.slice(4, 6)).toEqual(['node', '-e']);
    expect(exec[6]).not.toContain('ssh-test.example.test');
  });

  it('warns, never fails, when the connection cannot be opened', async () => {
    const { run } = docker(result({ exitCode: 2 }));

    const outcome = await createSshEgressCheck(run).run(context({ SSH_EGRESS_TEST_HOST: 'ssh-test.example.test' }));

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('ssh-test.example.test:22');
  });

  it('warns about a malformed value without running anything', async () => {
    const { run, asked } = docker(result({}));

    const outcome = await createSshEgressCheck(run).run(context({ SSH_EGRESS_TEST_HOST: 'not a host' }));

    expect(outcome.status).toBe('warn');
    expect(asked).toEqual([]);
  });

  it('is a recommended check under its id, after the docker-daemon check', () => {
    const check = createSshEgressCheck();
    expect(check.id).toBe(SSH_EGRESS_CHECK_ID);
    expect(check.id).toBe('ssh-egress');
    expect(check.severity).toBe('recommended');
    expect(check.requires).toEqual(['docker-daemon']);
  });
});
