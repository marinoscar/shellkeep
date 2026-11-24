import { decodeUtf8Window, looksBinary } from './text-detect';

describe('looksBinary', () => {
  it('accepts plain, multi-byte and empty text', () => {
    expect(looksBinary(Buffer.from('hello\nworld\n'), false)).toBe(false);
    expect(looksBinary(Buffer.from('héllo — 日本語'), false)).toBe(false);
    expect(looksBinary(Buffer.alloc(0), false)).toBe(false);
  });

  it('flags a NUL byte', () => {
    expect(looksBinary(Buffer.from([0x68, 0x00, 0x69]), false)).toBe(true);
  });

  it('flags invalid UTF-8', () => {
    expect(looksBinary(Buffer.from([0xff, 0xfe, 0x41]), false)).toBe(true);
    expect(looksBinary(Buffer.from([0xc3, 0x28]), false)).toBe(true);
  });

  it('only inspects the first 8 KB', () => {
    const buf = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0x00])]);
    expect(looksBinary(buf, false)).toBe(false);
  });

  it('forgives a character cut at the end of a truncated head, not of a whole file', () => {
    const cut = Buffer.concat([Buffer.from('ab'), Buffer.from('é').subarray(0, 1)]);
    expect(looksBinary(cut, true)).toBe(false);
    expect(looksBinary(cut, false)).toBe(true);
    const atBoundary = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from('é')]);
    expect(looksBinary(atBoundary, false)).toBe(false);
  });
});

describe('decodeUtf8Window', () => {
  const euro = Buffer.from('€'); // 3 bytes

  it('decodes a whole buffer', () => {
    expect(decodeUtf8Window(Buffer.from('a€b'), true)).toEqual({ text: 'a€b', skipped: 0, length: 5 });
  });

  it('leaves an incomplete trailing character for the next window unless at eof', () => {
    const buf = Buffer.concat([Buffer.from('a'), euro.subarray(0, 2)]);
    expect(decodeUtf8Window(buf, false)).toEqual({ text: 'a', skipped: 0, length: 1 });
    expect(decodeUtf8Window(buf, true)).toBeNull();
  });

  it('skips the continuation bytes of a character that began before the window', () => {
    const buf = Buffer.concat([euro.subarray(1), Buffer.from('bc')]);
    expect(decodeUtf8Window(buf, true)).toEqual({ text: 'bc', skipped: 2, length: 2 });
  });

  it('returns null for invalid UTF-8', () => {
    expect(decodeUtf8Window(Buffer.from([0x61, 0xff, 0x62]), true)).toBeNull();
  });

  it('chains windows without losing or repeating a byte', () => {
    const whole = Buffer.from('€€€€€x');
    let at = 0;
    let out = '';
    while (at < whole.length) {
      const win = decodeUtf8Window(whole.subarray(at, at + 4), at + 4 >= whole.length)!;
      out += win.text;
      at += win.skipped + win.length;
    }
    expect(out).toBe('€€€€€x');
  });
});
