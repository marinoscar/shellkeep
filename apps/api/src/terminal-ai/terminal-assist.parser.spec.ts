import { parseAssistOutput } from './terminal-assist.parser';

describe('parseAssistOutput', () => {
  it('reads COMMAND and WHY', () => {
    expect(parseAssistOutput('COMMAND: ls -la\nWHY: Lists files.')).toEqual({ command: 'ls -la', explanation: 'Lists files.' });
  });

  it('ignores fences and wrapping backticks', () => {
    expect(parseAssistOutput('```\nCOMMAND: `df -h`\nWHY: Disk use.\n```')?.command).toBe('df -h');
  });

  it('joins a multi-line explanation', () => {
    expect(parseAssistOutput('COMMAND: id\nWHY: Shows the user\nand groups.')?.explanation).toBe('Shows the user and groups.');
  });

  it.each([
    ['no command line', 'just chatting'],
    ['empty command', 'COMMAND:   \nWHY: x'],
    ['escape in command', 'COMMAND: ls \u001b[31m\nWHY: x'],
    ['control char in command', 'COMMAND: ls\u0003\nWHY: x'],
    ['DEL in command', 'COMMAND: ls\u007f\nWHY: x'],
    ['over-long command', `COMMAND: ${'a'.repeat(1001)}\nWHY: x`],
  ])('rejects %s', (_name, text) => {
    expect(parseAssistOutput(text)).toBeNull();
  });

  it('never returns a multi-line command', () => {
    const parsed = parseAssistOutput('COMMAND: cd /tmp\nrm -rf x\nWHY: y');
    expect(parsed?.command).toBe('cd /tmp');
  });
});
