import { Client } from 'ssh2';

import { startRunbookSshFixture, type RunbookSshFixture } from '../../../test/runbooks/runbook-ssh-fixture';
import { SshExecutor, buildStdin, execCommandLine, shellQuote, type ExecChunk } from './ssh-executor';

/** A sentinel assembled at run time, so no secret-shaped literal sits in the source. */
const SENTINEL = ['sentinel', 'value', Math.random().toString(36).slice(2, 10)].join('-');

describe('SshExecutor against a real shell', () => {
  let fixture: RunbookSshFixture;
  let client: Client;
  const executor = new SshExecutor();

  beforeAll(async () => {
    fixture = await startRunbookSshFixture();
    client = await new Promise<Client>((resolve, reject) => {
      const c = new Client();
      c.on('ready', () => resolve(c));
      c.on('error', reject);
      c.connect({ host: '127.0.0.1', port: fixture.port, username: fixture.username, password: fixture.password, hostVerifier: () => true });
    });
  });

  afterAll(async () => {
    client.end();
    await fixture.close();
  });

  const collect = () => {
    const chunks: ExecChunk[] = [];
    return { chunks, onChunk: (c: ExecChunk) => chunks.push(c), text: (s?: 'stdout' | 'stderr') => Buffer.concat(chunks.filter((c) => !s || c.stream === s).map((c) => c.data)).toString('utf8') };
  };

  it('runs a command, streams stdout and stderr apart and reports the exit code', async () => {
    const out = collect();
    const result = await executor.exec(client, { script: 'echo hi; echo oops >&2; exit 3', strict: false, timeoutSec: 10, onChunk: out.onChunk });
    expect(result).toMatchObject({ exitCode: 3, timedOut: false, aborted: false });
    expect(out.text('stdout')).toBe('hi\n');
    expect(out.text('stderr')).toBe('oops\n');
    expect(result.bytes).toBe(8);
    expect(result.commandSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends only `bash -s` as argv; the command, parameters and secrets travel on stdin', async () => {
    const before = fixture.execs.length;
    const out = collect();
    const result = await executor.exec(client, {
      script: 'echo "$GREETING:$TOKEN"',
      strict: true,
      env: { GREETING: "it's" },
      secrets: { TOKEN: SENTINEL },
      timeoutSec: 10,
      onChunk: out.onChunk,
    });
    expect(result.exitCode).toBe(0);
    expect(out.text('stdout')).toBe(`it's:${SENTINEL}\n`);
    expect(fixture.execs.slice(before)).toEqual(['bash -s']);
    expect(fixture.execs.join('\n')).not.toContain(SENTINEL);
    expect(fixture.execs.join('\n')).not.toContain('echo');
    expect(fixture.stdins[fixture.stdins.length - 1]).toContain(SENTINEL);
  });

  it('uses the sudo -n form without putting anything else in argv', async () => {
    const before = fixture.execs.length;
    await executor.exec(client, { script: 'true', runAs: { sudo: true, user: 'deploy' }, timeoutSec: 10, onChunk: () => undefined });
    await executor.exec(client, { script: 'true', runAs: { sudo: true }, timeoutSec: 10, onChunk: () => undefined });
    expect(fixture.execs.slice(before)).toEqual(['sudo -n -u deploy bash -s', 'sudo -n bash -s']);
  });

  it('runs python3 through `python3 -` with parameters in the environment', async () => {
    const out = collect();
    const result = await executor.exec(client, {
      script: 'import os, sys\nprint(os.environ["WHO"], sys.argv[1:])',
      interpreter: 'python3',
      env: { WHO: 'py' },
      args: ['a'],
      timeoutSec: 10,
      onChunk: out.onChunk,
    });
    expect(result.exitCode).toBe(0);
    expect(out.text('stdout')).toBe("py ['a']\n");
    expect(fixture.execs[fixture.execs.length - 1]).toBe('python3 -');
  });

  it('a command that reads stdin does not swallow the rest of the script', async () => {
    const out = collect();
    const result = await executor.exec(client, { script: 'cat >/dev/null\necho after', strict: true, timeoutSec: 10, onChunk: out.onChunk });
    expect(result.exitCode).toBe(0);
    expect(out.text('stdout')).toBe('after\n');
  });

  it('strict mode stops at the first failing command; non-strict continues', async () => {
    const strict = collect();
    const r1 = await executor.exec(client, { script: 'false\necho unreachable', strict: true, timeoutSec: 10, onChunk: strict.onChunk });
    expect(r1.exitCode).toBe(1);
    expect(strict.text()).toBe('');
    const loose = collect();
    const r2 = await executor.exec(client, { script: 'false\necho reached', strict: false, timeoutSec: 10, onChunk: loose.onChunk });
    expect(r2.exitCode).toBe(0);
    expect(loose.text()).toBe('reached\n');
  });

  it('a timeout sends INT and reports timedOut', async () => {
    const before = fixture.signals.length;
    const started = Date.now();
    const result = await executor.exec(client, { script: 'sleep 30', strict: true, timeoutSec: 1, onChunk: () => undefined });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(fixture.signals.slice(before)).toContain('INT');
  }, 20_000);

  it('an abort sends INT and reports aborted', async () => {
    const controller = new AbortController();
    const before = fixture.signals.length;
    const pending = executor.exec(client, { script: 'sleep 30', strict: true, timeoutSec: 60, signal: controller.signal, onChunk: () => undefined });
    setTimeout(() => controller.abort(), 300);
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(fixture.signals.slice(before)).toContain('INT');
  }, 20_000);

  it('caps what it delivers and says so', async () => {
    const out = collect();
    const result = await executor.exec(client, { script: 'head -c 5000 /dev/zero | tr "\\0" x', maxBytes: 100, timeoutSec: 10, onChunk: out.onChunk });
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeGreaterThan(100);
    expect(out.text().length).toBeLessThanOrEqual(5000);
  });
});

describe('the stdin a script is wrapped in', () => {
  it('quotes every value as a shell literal and picks a heredoc delimiter the body does not contain', () => {
    const stdin = buildStdin({ script: 'echo SK_EOF_X', strict: true, env: { A: "a'b" }, workdir: '/var/app dir', timeoutSec: 1, onChunk: () => undefined }, 'SK_EOF_X');
    expect(stdin).toContain("export A='a'\\''b'");
    expect(stdin).toContain("cd -- '/var/app dir'");
    expect(stdin.startsWith('set -euo pipefail\n')).toBe(true);
  });

  it('refuses an invalid variable name', () => {
    expect(() => buildStdin({ script: 'true', env: { 'A B': '1' }, timeoutSec: 1, onChunk: () => undefined }, 'D')).toThrow();
  });

  it('execCommandLine never carries the script', () => {
    expect(execCommandLine({})).toBe('bash -s');
    expect(execCommandLine({ interpreter: 'sh' })).toBe('sh -s');
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});
