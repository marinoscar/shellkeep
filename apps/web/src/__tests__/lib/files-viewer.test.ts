import { describe, it, expect } from 'vitest';
import { isImagePath, pickLanguage } from '../../lib/files/viewer/language';
import {
  ENV_MASK,
  checkJson,
  logLevelOf,
  maskEnv,
  parseJumpTarget,
  percentOffset,
  previousOffset,
  stripAnsi,
  tailOffset,
  trimToTail,
} from '../../lib/files/viewer/text';
import { renderMarkdown } from '../../lib/files/viewer/markdown';
import { loadLanguage } from '../../lib/files/viewer/languages';

describe('pickLanguage (#154)', () => {
  it.each([
    ['/srv/app/README.md', 'markdown'],
    ['notes.markdown', 'markdown'],
    ['/etc/app/config.json', 'json'],
    ['catalog.json', 'json'],
    ['docker-compose.yml', 'yaml'],
    ['values.yaml', 'yaml'],
    ['pom.xml', 'xml'],
    ['icon.svg', 'xml'],
    ['deploy.sh', 'shell'],
    ['run.bash', 'shell'],
    ['setup.zsh', 'shell'],
    ['/home/a/.bashrc', 'shell'],
    ['~/.profile', 'shell'],
    ['.zshrc', 'shell'],
    ['php.ini', 'ini'],
    ['/etc/sysctl.conf', 'ini'],
    ['app.service', 'ini'],
    ['Cargo.toml', 'toml'],
    ['Dockerfile', 'dockerfile'],
    ['Dockerfile.prod', 'dockerfile'],
    ['api.dockerfile', 'dockerfile'],
    ['/etc/nginx/nginx.conf', 'nginx'],
    ['/etc/nginx/sites-enabled/site-a.conf', 'nginx'],
    ['.env', 'env'],
    ['.env.production', 'env'],
    ['prod.env', 'env'],
    ['/var/log/app.log', 'log'],
    ['/var/log/app.log.3', 'log'],
    ['/var/log/syslog', 'log'],
    ['journal-export.txt', 'log'],
    ['changelog', 'log'],
    ['notes.txt', 'plain'],
    ['Makefile', 'plain'],
  ])('%s opens as %s', (path, language) => {
    expect(pickLanguage(path)).toBe(language);
  });

  it('picks shell for an extensionless script with a shell shebang', () => {
    expect(pickLanguage('/usr/local/bin/backup', '#!/usr/bin/env bash')).toBe('shell');
    expect(pickLanguage('/usr/local/bin/backup', '#!/bin/sh')).toBe('shell');
    expect(pickLanguage('/usr/local/bin/tool', '#!/usr/bin/python3')).toBe('plain');
  });

  it('knows the previewable images', () => {
    expect(['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg'].every(isImagePath)).toBe(true);
    expect(isImagePath('g.bmp')).toBe(false);
    expect(isImagePath('png')).toBe(false);
  });

  it('loads a language pack for every grammar mode, none for logs and plain text', async () => {
    for (const language of ['json', 'markdown', 'yaml', 'xml', 'shell', 'ini', 'env', 'toml', 'dockerfile', 'nginx'] as const) {
      const extension = await loadLanguage(language);
      expect(extension, language).not.toEqual([]);
    }
    expect(await loadLanguage('log')).toEqual([]);
    expect(await loadLanguage('plain')).toEqual([]);
  });
});

describe('log helpers (#154)', () => {
  it('strips colours, cursor moves and titles', () => {
    const raw = '\u001b[31mERROR\u001b[0m disk full\u001b[2K\n\u001b]0;title\u0007INFO \u001b[1;32mok\u001b[m';
    expect(stripAnsi(raw)).toBe('ERROR disk full\nINFO ok');
  });

  it('classifies level words', () => {
    expect(logLevelOf('FATAL')).toBe('error');
    expect(logLevelOf('WARNING')).toBe('warn');
    expect(logLevelOf('NOTICE')).toBe('info');
    expect(logLevelOf('debug')).toBeNull();
  });
});

describe('maskEnv (#154)', () => {
  it('masks every non-empty value with a fixed-length mask and keeps comments and keys', () => {
    const { text, masked } = maskEnv('# database\nDB_PASSWORD=hunter-two\nexport API_TOKEN="abc"\nEMPTY=\n\nNOT AN ASSIGNMENT');
    expect(masked).toBe(2);
    expect(text).toBe(
      `# database\nDB_PASSWORD=${ENV_MASK}\nexport API_TOKEN=${ENV_MASK}\nEMPTY=\n\nNOT AN ASSIGNMENT`,
    );
    expect(text).not.toContain('hunter-two');
    expect(text).not.toContain('abc');
  });
});

describe('checkJson (#154)', () => {
  it('pretty-prints valid JSON', () => {
    expect(checkJson('{"a":1,"b":[true,null]}')).toEqual({
      ok: true,
      formatted: '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    });
  });

  it('reports the line and column of a parse error', () => {
    const result = checkJson('{\n  "a": 1,\n  "b": }\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.line).toBe(3);
    expect(result.column).toBe(8);
    expect(result.message).not.toMatch(/line \d+ column/);
  });

  it('reports an empty or truncated document at its end', () => {
    const result = checkJson('{"a": [1, 2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(1);
  });
});

describe('paged offsets (#154)', () => {
  it('computes the tail, previous and percentage windows', () => {
    expect(tailOffset(10_000, 4_000)).toBe(6_000);
    expect(tailOffset(1_000, 4_000)).toBe(0);
    expect(previousOffset(6_000, 4_000)).toBe(2_000);
    expect(previousOffset(1_000, 4_000)).toBe(0);
    expect(percentOffset(10_000, 50)).toBe(5_000);
    expect(percentOffset(10_000, 150)).toBe(10_000);
  });

  it('parses jump targets as percentages, bytes and sizes', () => {
    const size = 10 * 1024 * 1024;
    expect(parseJumpTarget('50%', size)).toBe(5 * 1024 * 1024);
    expect(parseJumpTarget('1024', size)).toBe(1024);
    expect(parseJumpTarget('512k', size)).toBe(512 * 1024);
    expect(parseJumpTarget('3m', size)).toBe(3 * 1024 * 1024);
    expect(parseJumpTarget('3MB', size)).toBe(3 * 1024 * 1024);
    expect(parseJumpTarget('101%', size)).toBeNull();
    expect(parseJumpTarget('11m', size)).toBeNull();
    expect(parseJumpTarget('abc', size)).toBeNull();
  });

  it('trims a followed buffer at a line boundary', () => {
    expect(trimToTail('aaa\nbbb\nccc', 100)).toEqual({ text: 'aaa\nbbb\nccc', dropped: 0 });
    expect(trimToTail('aaa\nbbb\nccc', 6)).toEqual({ text: 'ccc', dropped: 8 });
  });
});

describe('renderMarkdown (#154)', () => {
  it('renders Markdown', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and `code`.\n\n- one\n- two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('never executes raw HTML, scripts or javascript: links, and drops images', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[click](javascript:alert(3))\n\n![pixel](https://tracker.example.test/p.png)',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<[^>]*onerror/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('opens links in a new tab without an opener', () => {
    const html = renderMarkdown('[docs](https://docs.example.test/)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
