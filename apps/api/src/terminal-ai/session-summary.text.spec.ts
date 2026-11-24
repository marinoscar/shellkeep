import {
  cleanSummary,
  mergeFindings,
  splitIntoChunks,
  SUMMARY_MAX_COMMANDS,
  SUMMARY_MAX_COMMAND_CHARS,
  SUMMARY_MAX_MD_CHARS,
} from './session-summary.text';

// Assembled at run time so no secret-shaped literal sits in the repository.
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');

describe('splitIntoChunks', () => {
  it('returns nothing for empty text and one chunk for short text', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('a\nb', 10)).toEqual(['a\nb']);
  });

  it('splits on line boundaries and never exceeds the limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}-${'x'.repeat(20)}`);
    const chunks = splitIntoChunks(lines.join('\n'), 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    // Every chunk starts at the start of a line and the lines survive in order.
    expect(chunks.join('\n')).toBe(lines.join('\n'));
  });

  it('cuts a single over-long line into pieces', () => {
    const chunks = splitIntoChunks('y'.repeat(250), 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('splits 150k characters into three chunks of at most 60k', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `row ${i} ${'z'.repeat(40)}`).join('\n');
    const chunks = splitIntoChunks(text, 60_000);
    expect(text.length).toBeGreaterThan(120_000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60_000);
  });
});

describe('mergeFindings', () => {
  it('adds the counts of one kind', () => {
    expect(
      mergeFindings([{ kind: 'aws_access_key', count: 1 }], [{ kind: 'aws_access_key', count: 2 }, { kind: 'jwt', count: 1 }]),
    ).toEqual([
      { kind: 'aws_access_key', count: 3 },
      { kind: 'jwt', count: 1 },
    ]);
  });
});

describe('cleanSummary', () => {
  it('redacts a secret the model echoes, in the summary and in a command', () => {
    const cleaned = cleanSummary({
      summaryMd: `Exported the key ${AWS_KEY} for the deploy.`,
      commands: [{ command: `export AWS_ACCESS_KEY_ID=${AWS_KEY}`, outcome: 'ok' }],
    });
    expect(cleaned.summaryMd).not.toContain(AWS_KEY);
    expect(cleaned.commands[0]?.command).not.toContain(AWS_KEY);
    expect(cleaned.findings.length).toBeGreaterThan(0);
  });

  it('caps the summary, the number of commands and each command, and drops empty ones', () => {
    const cleaned = cleanSummary({
      summaryMd: 'm'.repeat(SUMMARY_MAX_MD_CHARS + 500),
      commands: [
        { command: '   ' },
        ...Array.from({ length: SUMMARY_MAX_COMMANDS + 20 }, () => ({ command: 'c'.repeat(SUMMARY_MAX_COMMAND_CHARS + 50) })),
      ],
    });
    expect(cleaned.summaryMd.length).toBeLessThanOrEqual(SUMMARY_MAX_MD_CHARS);
    expect(cleaned.commands).toHaveLength(SUMMARY_MAX_COMMANDS);
    expect(cleaned.commands[0]?.command.length).toBeLessThanOrEqual(SUMMARY_MAX_COMMAND_CHARS);
  });
});
