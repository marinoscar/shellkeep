import { parseExplainOutput } from './terminal-explain.parser';

describe('parseExplainOutput', () => {
  it('splits the markdown from a final COMMAND line', () => {
    const out = parseExplainOutput('## What happened\nx\n\nCOMMAND: ls -la\n');
    expect(out).toEqual({ markdown: '## What happened\nx', command: 'ls -la' });
  });

  it('unwraps backticks around the command', () => {
    expect(parseExplainOutput('## A\nx\nCOMMAND: `df -h`')?.command).toBe('df -h');
  });

  it('keeps a COMMAND line that is not last as prose', () => {
    const out = parseExplainOutput('COMMAND: ls\n## A\nx');
    expect(out?.command).toBeUndefined();
    expect(out?.markdown).toContain('COMMAND: ls');
  });

  it('drops a command with a control character but keeps the markdown', () => {
    const out = parseExplainOutput('## A\nx\nCOMMAND: ls\u001b[2J');
    expect(out).toEqual({ markdown: '## A\nx' });
  });

  it('is null for an empty answer', () => {
    expect(parseExplainOutput('  \n')).toBeNull();
    expect(parseExplainOutput('COMMAND: ls')).toBeNull();
  });
});
