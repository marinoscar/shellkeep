import { MODEL_OUTPUT_MAX_BYTES, prepareModelOutput, redactForStorage, truncateMiddle } from './agent-output';

/** Assembled at run time: no secret-shaped literal sits in the source. */
const SENTINEL = ['sentinel', 'secret', Math.random().toString(36).slice(2, 12)].join('-');

describe('prepareModelOutput', () => {
  it('strips ANSI sequences', () => {
    expect(prepareModelOutput('\u001b[31mred\u001b[0m text', []).text).toBe('red text');
  });

  it('redacts the run secrets as [REDACTED:literal] and a shaped secret as [REDACTED:<kind>]', () => {
    const shaped = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const out = prepareModelOutput(`value ${SENTINEL}\nkey ${shaped}\n`, [SENTINEL]).text;
    expect(out).not.toContain(SENTINEL);
    expect(out).not.toContain(shaped);
    expect(out).toContain('[REDACTED:literal]');
    expect(out).toMatch(/\[REDACTED:[a-z_]+\]/);
  });

  it('cuts to 8 KiB with [truncated], keeping head and tail', () => {
    const text = `HEAD${'x'.repeat(40_000)}TAIL`;
    const out = prepareModelOutput(text, []);
    expect(out.truncated).toBe(true);
    expect(Buffer.byteLength(out.text, 'utf8')).toBeLessThanOrEqual(MODEL_OUTPUT_MAX_BYTES);
    expect(out.text).toContain('[truncated]');
    expect(out.text.startsWith('HEAD')).toBe(true);
    expect(out.text.endsWith('TAIL')).toBe(true);
  });

  it('redacts before it cuts, so a secret on the cut cannot survive as a fragment', () => {
    const text = `${'a'.repeat(MODEL_OUTPUT_MAX_BYTES / 2 - 4)}${SENTINEL}${'b'.repeat(MODEL_OUTPUT_MAX_BYTES * 2)}`;
    const out = prepareModelOutput(text, [SENTINEL]).text;
    expect(out).not.toContain(SENTINEL.slice(0, 12));
  });

  it('keeps multi-byte characters whole', () => {
    const out = truncateMiddle('é'.repeat(20_000), 1000).text;
    expect(out).not.toContain('�');
  });
});

describe('redactForStorage', () => {
  it('redacts and caps', () => {
    const out = redactForStorage(`run ${SENTINEL} ${'z'.repeat(100)}`, [SENTINEL], 40);
    expect(out).not.toContain(SENTINEL);
    expect(out.length).toBeLessThanOrEqual(41);
  });
});
