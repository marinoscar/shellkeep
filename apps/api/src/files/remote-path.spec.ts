import { resolveRemotePath, needsBases, baseName } from './remote-path';

const home = '/home/alice';

describe('resolveRemotePath', () => {
  it('keeps an absolute path and normalises dots and slashes', () => {
    expect(resolveRemotePath('/var/log//nginx/../app.log', { home })).toBe('/var/log/app.log');
    expect(resolveRemotePath('/var/log/', { home })).toBe('/var/log');
    expect(resolveRemotePath('/', { home })).toBe('/');
  });

  it('cannot climb above the root', () => {
    expect(resolveRemotePath('/../../etc/passwd', { home })).toBe('/etc/passwd');
  });

  it('expands ~ against home', () => {
    expect(resolveRemotePath('~', { home, cwd: '/srv' })).toBe(home);
    expect(resolveRemotePath('~/notes/a.txt', { home, cwd: '/srv' })).toBe('/home/alice/notes/a.txt');
  });

  it('resolves a relative path against the session cwd, else home', () => {
    expect(resolveRemotePath('./logs/app.log', { home, cwd: '/srv/app' })).toBe('/srv/app/logs/app.log');
    expect(resolveRemotePath('../x', { home, cwd: '/srv/app' })).toBe('/srv/x');
    expect(resolveRemotePath('a.txt', { home })).toBe('/home/alice/a.txt');
    expect(resolveRemotePath('a.txt', { home, cwd: null })).toBe('/home/alice/a.txt');
  });

  it('does not treat ~user or a mid-path ~ as home', () => {
    expect(resolveRemotePath('~bob/x', { home })).toBe('/home/alice/~bob/x');
    expect(resolveRemotePath('/a/~/b', { home })).toBe('/a/~/b');
  });

  it('refuses an empty path, a NUL byte and an oversized path', () => {
    for (const bad of ['', '   ', '/etc/pass\0wd', '/' + 'a'.repeat(5000)]) {
      expect(() => resolveRemotePath(bad, { home })).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('keeps shell metacharacters as plain characters', () => {
    expect(resolveRemotePath('/tmp/$(rm -rf x);`id`', { home })).toBe('/tmp/$(rm -rf x);`id`');
  });

  it('reports which bases a path needs', () => {
    expect(needsBases('/etc')).toEqual({ home: false, cwd: false });
    expect(needsBases('~/x')).toEqual({ home: true, cwd: false });
    expect(needsBases('x')).toEqual({ home: true, cwd: true });
  });

  it('takes the file name for a download', () => {
    expect(baseName('/var/log/app.log')).toBe('app.log');
    expect(baseName('/')).toBe('download');
  });
});
