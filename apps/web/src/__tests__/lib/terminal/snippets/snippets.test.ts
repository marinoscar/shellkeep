import { describe, it, expect, vi } from 'vitest';
import { extractPlaceholders, fillPlaceholders } from '../../../../lib/terminal/snippets/placeholders';
import { insertSnippetText, prepareSnippetText } from '../../../../lib/terminal/snippets/insert';

describe('placeholders', () => {
  it('lists the distinct names in order of first appearance', () => {
    expect(extractPlaceholders('ssh {{user}}@{{ host }} -p {{port}} # {{user}}')).toEqual(['user', 'host', 'port']);
  });

  it('ignores braces that are not a name', () => {
    expect(extractPlaceholders('echo {{}} {{ }} {{1x}} {single} {{a b}}')).toEqual([]);
  });

  it('fills every occurrence, with an empty string for a missing value, and never re-expands a value', () => {
    expect(fillPlaceholders('{{a}}-{{b}}-{{a}}', { a: '1' })).toBe('1--1');
    expect(fillPlaceholders('x {{a}} y', { a: '{{b}}', b: 'no' })).toBe('x {{b}} y');
  });
});

describe('prepareSnippetText', () => {
  it('drops control characters, keeps tabs and newlines, and removes trailing line breaks', () => {
    expect(prepareSnippetText('ls\x1b[2J\x03\ttab\r\nnext\r\n\n')).toBe('ls[2J\ttab\nnext');
  });
});

describe('insertSnippetText', () => {
  const makeView = (bracketed: boolean | undefined) => {
    const terminal = { paste: vi.fn(), modes: { bracketedPasteMode: bracketed } };
    return { terminal, view: { getTerminal: () => terminal as never, focus: vi.fn() } };
  };

  it('pastes a single line and focuses the pane, with no Enter', () => {
    const { terminal, view } = makeView(false);
    expect(insertSnippetText(view, 'docker ps -a\n')).toBe('inserted');
    expect(terminal.paste).toHaveBeenCalledWith('docker ps -a');
    expect(view.focus).toHaveBeenCalled();
  });

  it('pastes a multi-line snippet when bracketed paste is on', () => {
    const { terminal, view } = makeView(true);
    expect(insertSnippetText(view, 'a\nb')).toBe('inserted');
    expect(terminal.paste).toHaveBeenCalledWith('a\nb');
  });

  it('asks before pasting a multi-line snippet without bracketed paste, and pastes once confirmed', () => {
    const { terminal, view } = makeView(false);
    expect(insertSnippetText(view, 'a\nb')).toBe('needs-confirmation');
    expect(terminal.paste).not.toHaveBeenCalled();
    expect(insertSnippetText(view, 'a\nb', { confirmed: true })).toBe('inserted');
    expect(terminal.paste).toHaveBeenCalledWith('a\nb');
  });

  it('is unavailable without a terminal or with nothing left to insert', () => {
    expect(insertSnippetText(null, 'x')).toBe('unavailable');
    expect(insertSnippetText({ getTerminal: () => null, focus: vi.fn() }, 'x')).toBe('unavailable');
    expect(insertSnippetText(makeView(true).view, '\n\n')).toBe('unavailable');
  });
});
