import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { archiveFileName, buildTarCommand, shellQuote, splitArchivePath } from './tar-command';

describe('shellQuote', () => {
  it('single-quotes and escapes embedded quotes', () => {
    expect(shellQuote('plain')).toBe(`'plain'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
    expect(shellQuote('')).toBe(`''`);
  });

  it('refuses a NUL byte', () => {
    expect(() => shellQuote('a\0b')).toThrow();
  });
});

describe('buildTarCommand', () => {
  it('builds the exact argv shape: parent with -C, the entry after --', () => {
    expect(buildTarCommand('/var/log/app')).toBe(`tar -czf - -C '/var/log' -- 'app'`);
    expect(buildTarCommand('/home')).toBe(`tar -czf - -C '/' -- 'home'`);
    expect(buildTarCommand('/')).toBe(`tar -czf - -C '/' -- '.'`);
  });

  it('quotes names a shell would interpret', () => {
    expect(buildTarCommand(`/srv/it's $(reboot);rm -rf ~ \`id\` "x"/-rf *`)).toBe(
      `tar -czf - -C '/srv/it'\\''s $(reboot);rm -rf ~ \`id\` "x"' -- '-rf *'`,
    );
  });

  it('splits and names the download', () => {
    expect(splitArchivePath('/a/b')).toEqual({ parent: '/a', base: 'b' });
    expect(archiveFileName('/a/b')).toBe('b.tar.gz');
    expect(archiveFileName('/')).toBe('archive.tar.gz');
    expect(() => splitArchivePath('relative')).toThrow();
  });

  // The real shell and the real tar: every nasty name reaches tar as ONE literal argument, and no
  // substitution or second command runs.
  describe('under a real shell', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'tar-cmd-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const names = [`plain dir`, `it's`, `$(touch ${'$ROOT'}/pwned)`, '`touch pwned2`', ';touch pwned3;', '-rf', '--checkpoint=1', `new\nline`, '"quoted"', '*', '~', '#hash & (parens)'];

    it.each(names)('archives a folder named %j and runs nothing else', (name) => {
      const dir = join(root, name.replace('$ROOT', root));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'inner file.txt'), 'hello');
      const out = execFileSync('sh', ['-c', `${buildTarCommand(dir)} | tar -tzf -`], { cwd: root, encoding: 'utf8' });
      const entries = out.split('\n').filter(Boolean);
      expect(entries.some((entry) => entry.endsWith('inner file.txt'))).toBe(true);
      for (const stray of ['pwned', 'pwned2', 'pwned3']) {
        expect(existsSync(join(root, stray))).toBe(false);
        expect(existsSync(join(dir, stray))).toBe(false);
      }
    });

    it('archives a parent whose own name is nasty', () => {
      const parent = join(root, `we ird '$(x)'`);
      mkdirSync(join(parent, 'child'), { recursive: true });
      writeFileSync(join(parent, 'child', 'f'), 'x');
      const out = execFileSync('sh', ['-c', `${buildTarCommand(join(parent, 'child'))} | tar -tzf -`], { encoding: 'utf8' });
      expect(out.split('\n').filter(Boolean)).toEqual(['child/', 'child/f']);
    });
  });
});
