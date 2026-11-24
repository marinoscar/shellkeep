import { describe, it, expect } from 'vitest';
import { findFileReferences, isFileLikePath, MAX_REFERENCES_PER_LINE } from '../../../lib/terminal/file-links';

const paths = (line: string) => findFileReferences(line).map((r) => r.path);

describe('findFileReferences (#155)', () => {
  describe('positives', () => {
    it.each([
      ['cat /var/log/app/error.log', '/var/log/app/error.log'],
      ['edit ~/notes/todo.md', '~/notes/todo.md'],
      ['run ./scripts/start.sh now', './scripts/start.sh'],
      ['see ../shared/env', '../shared/env'],
      ['wrote src/app.ts', 'src/app.ts'],
      ['open config.yaml', 'config.yaml'],
      ['logs/', 'logs/'],
      ['Dockerfile', 'Dockerfile'],
      ['.env', '.env'],
      ['node_modules/@types/node/index.d.ts', 'node_modules/@types/node/index.d.ts'],
    ])('finds the path in %j', (line, expected) => {
      expect(paths(line)).toEqual([expected]);
    });

    it('keeps the indices of the link text', () => {
      const line = 'tail -f /var/log/x.log';
      const [ref] = findFileReferences(line);
      expect(line.slice(ref.start, ref.end)).toBe('/var/log/x.log');
    });

    it('finds several references in one line, in order', () => {
      expect(paths('cp ./a.txt ../b/c.txt ~/d.json')).toEqual(['./a.txt', '../b/c.txt', '~/d.json']);
    });
  });

  describe('line and column', () => {
    it('reads path:line', () => {
      expect(findFileReferences('src/app.ts:42')).toEqual([{ path: 'src/app.ts', line: 42, start: 0, end: 13 }]);
    });

    it('reads path:line:col with grep and compiler output after it', () => {
      const line = 'src/app.ts:42:7: error TS2304: Cannot find name';
      const [ref] = findFileReferences(line);
      expect(ref).toMatchObject({ path: 'src/app.ts', line: 42, col: 7 });
      expect(line.slice(ref.start, ref.end)).toBe('src/app.ts:42:7');
    });

    it('reads a stack-trace frame inside parentheses', () => {
      expect(findFileReferences('    at main (/srv/app/dist/main.js:10:3)')[0]).toMatchObject({
        path: '/srv/app/dist/main.js',
        line: 10,
        col: 3,
      });
    });

    it('reads the (line,col) form', () => {
      const line = 'src/x.ts(12,5): error';
      const [ref] = findFileReferences(line);
      expect(ref).toMatchObject({ path: 'src/x.ts', line: 12, col: 5 });
      expect(line.slice(ref.start, ref.end)).toBe('src/x.ts(12,5)');
    });

    it('ignores a line number of zero', () => {
      expect(findFileReferences('a/b.ts:0')[0]).toEqual({ path: 'a/b.ts', start: 0, end: 8 });
    });
  });

  describe('punctuation trimming', () => {
    it.each([
      ['See /etc/hosts.', '/etc/hosts'],
      ['files: /etc/a.conf, /etc/b.conf', '/etc/a.conf'],
      ['(see ./x.md)', './x.md'],
      ['"~/q.txt"', '~/q.txt'],
      ["'src/y.ts'", 'src/y.ts'],
      ['at /tmp/z.log:', '/tmp/z.log'],
      ['wrote config.yaml!', 'config.yaml'],
    ])('trims %j', (line, expected) => {
      expect(paths(line)[0]).toBe(expected);
    });

    it('reads a Python traceback path between quotes', () => {
      expect(paths('File "/usr/lib/tool/x.py", line 3')).toEqual(['/usr/lib/tool/x.py']);
    });
  });

  describe('negatives', () => {
    it.each([
      'https://example.test/a/b.txt',
      'ftp://files.example.test/pub/x.tar.gz',
      'mail person-a@example.test',
      'git@host.example.test:org/repo.git',
      '42',
      'version 1.2.3',
      'v2.10.0',
      '2024/01/02 10:11:12',
      '192.168.10.20',
      'example.com',
      'hello world',
      '--verbose',
      '/',
      './',
      '//comment',
      'and/or',
    ])('finds nothing usable in %j', (line) => {
      const found = paths(line);
      // `and/or` is a candidate (the server's stat answers it), every other line yields none.
      if (line === 'and/or') expect(found).toEqual(['and/or']);
      else expect(found).toEqual([]);
    });

    it('never links anything inside a URL', () => {
      expect(paths('https://example.test/a(b)/c.txt and /tmp/real.log')).toEqual(['/tmp/real.log']);
      expect(paths('see http://example.test/docs/config.yaml')).toEqual([]);
    });

    it('rejects flags but reads the value after =', () => {
      expect(paths('--config=/etc/app.conf')).toEqual(['/etc/app.conf']);
    });
  });

  it('caps the references per line', () => {
    const line = Array.from({ length: 50 }, (_, i) => `/tmp/f${i}.log`).join(' ');
    expect(findFileReferences(line)).toHaveLength(MAX_REFERENCES_PER_LINE);
  });

  it('stays linear on a long adversarial line', () => {
    const adversarial = [
      'a.'.repeat(100_000),
      '/'.repeat(100_000),
      'x:1:'.repeat(50_000),
      'https://'.repeat(20_000),
      ' /a'.repeat(50_000),
      '~'.repeat(100_000),
      '1.'.repeat(100_000),
      `${'(1,'.repeat(30_000)}`,
    ];
    const started = performance.now();
    for (const line of adversarial) findFileReferences(line);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('isFileLikePath accepts the forms and rejects the rest', () => {
    expect(isFileLikePath('/a')).toBe(true);
    expect(isFileLikePath('~/a')).toBe(true);
    expect(isFileLikePath('README')).toBe(false);
    expect(isFileLikePath('notes.MD')).toBe(true);
    expect(isFileLikePath('1.2.3')).toBe(false);
  });
});
