import { describe, it, expect, vi } from 'vitest';
import { insertSuggestedCommand, sanitizeForInsert } from '../../../../components/terminal/ai/insertCommand';
import type { TerminalViewHandle } from '../../../../components/terminal/TerminalView';

describe('sanitizeForInsert (#57)', () => {
  it.each([
    ['LF', 'ls\n'],
    ['CR', 'ls\r'],
    ['CRLF in the middle', 'ls\r\nrm -rf x'],
    ['an escape sequence', 'ls \x1b[31m'],
    ['Ctrl+C', 'ls\x03'],
    ['DEL', 'ls\x7f'],
    ['a tab', 'ls\tfoo'],
    ['a C1 control', 'ls\u009b'],
    ['a line separator', 'ls foo'],
    ['an empty command', '   '],
  ])('rejects %s', (_name, command) => {
    expect(sanitizeForInsert(command)).toBeNull();
  });

  it('passes a normal command through unchanged, spaces and quotes included', () => {
    const command = `find /var -type f -size +100M -exec du -h {} + | sort -rh | head -n 10`;
    expect(sanitizeForInsert(command)).toBe(command);
    expect(sanitizeForInsert("echo 'héllo wörld' > /tmp/x")).toBe("echo 'héllo wörld' > /tmp/x");
  });
});

describe('insertSuggestedCommand (#57)', () => {
  const handle = () => {
    const paste = vi.fn();
    const view = {
      getTerminal: () => ({ paste }),
      sendInput: vi.fn(),
      focus: vi.fn(),
      reconnect: vi.fn(),
    } as unknown as TerminalViewHandle;
    return { view, paste };
  };

  it('pastes exactly once, with no trailing newline, and sends nothing to the PTY', () => {
    const { view, paste } = handle();
    expect(insertSuggestedCommand(view, 'df -h')).toBe(true);
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledWith('df -h');
    expect(paste.mock.calls[0]![0]).not.toMatch(/[\r\n]/);
    expect(view.sendInput).not.toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it('refuses a command with a newline or control character: nothing is pasted or sent', () => {
    const { view, paste } = handle();
    expect(insertSuggestedCommand(view, 'ls\nrm -rf /')).toBe(false);
    expect(insertSuggestedCommand(view, 'ls\x1b[2J')).toBe(false);
    expect(paste).not.toHaveBeenCalled();
    expect(view.sendInput).not.toHaveBeenCalled();
  });

  it('does nothing without a view or a terminal', () => {
    expect(insertSuggestedCommand(null, 'ls')).toBe(false);
    const view = { getTerminal: () => null, sendInput: vi.fn(), focus: vi.fn(), reconnect: vi.fn() } as TerminalViewHandle;
    expect(insertSuggestedCommand(view, 'ls')).toBe(false);
    expect(view.sendInput).not.toHaveBeenCalled();
  });
});
