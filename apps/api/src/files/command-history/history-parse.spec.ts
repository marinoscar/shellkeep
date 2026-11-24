import { HISTORY_FILES, MAX_COMMAND_CHARS, normalizeHistory, parseBash, parseFish, parseHistory, parseZsh, tailText } from './history-parse';

describe('history parsers', () => {
  it('lists bash, zsh and fish files in a fixed order, relative to home', () => {
    expect(HISTORY_FILES.map((f) => f.path)).toEqual(['.bash_history', '.zsh_history', '.local/share/fish/fish_history']);
  });

  it('parses bash lines and skips HISTTIMEFORMAT timestamp lines', () => {
    expect(parseBash('ls -la\n#1700000000\ncd /tmp\n\n')).toEqual(['ls -la', 'cd /tmp', '', '']);
    expect(parseHistory('bash', '# a comment\n')).toEqual(['# a comment', '']);
  });

  it('parses zsh plain and extended entries and joins backslash continuations', () => {
    const text = ': 1700000000:0;git status\nplain command\n: 1700000001:3;echo a \\\nb\n: 1700000002:0;ls\n';
    expect(parseZsh(text).filter(Boolean)).toEqual(['git status', 'plain command', 'echo a \nb', 'ls']);
  });

  it('keeps a zsh line that ends in an escaped backslash as one entry', () => {
    expect(parseZsh(': 1:0;echo a\\\\\nnext').filter(Boolean)).toEqual(['echo a\\\\', 'next']);
  });

  it('parses fish entries, unescaping \\n and \\\\, and ignores when/paths lines', () => {
    const text = '- cmd: ls -la\n  when: 1700000000\n- cmd: echo a\\nb\n  when: 1\n  paths:\n    - /tmp\n- cmd: echo \\\\x\n';
    expect(parseFish(text)).toEqual(['ls -la', 'echo a\nb', 'echo \\x']);
  });

  it('drops the first, possibly cut, line of a tail', () => {
    expect(tailText(Buffer.from('cut off\nsecond\nthird'), false)).toBe('second\nthird');
    expect(tailText(Buffer.from('first\nsecond'), true)).toBe('first\nsecond');
    expect(tailText(Buffer.from('no newline at all'), false)).toBe('');
  });
});

describe('normalizeHistory', () => {
  it('orders newest first, dedupes keeping the newest, and limits', () => {
    const oldest = ['a', 'b', 'a', 'c', 'b', 'd'];
    expect(normalizeHistory(oldest)).toEqual(['d', 'b', 'c', 'a']);
    expect(normalizeHistory(oldest, 2)).toEqual(['d', 'b']);
  });

  it('trims, strips control characters and drops empty and oversized entries', () => {
    const huge = 'x'.repeat(MAX_COMMAND_CHARS + 1);
    expect(normalizeHistory(['  ls  ', '', '   ', huge, 'a\u0007b\r', 'ok'])).toEqual(['ok', 'ab', 'ls']);
  });
});
