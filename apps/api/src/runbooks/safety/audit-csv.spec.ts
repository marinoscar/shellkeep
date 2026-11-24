import { csvCell, csvRow } from './audit-csv';

describe('csvCell', () => {
  it.each([
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\tcmd', "'\tcmd"],
  ])('prefixes the formula cell %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('quotes a prefixed cell that also needs quoting', () => {
    expect(csvCell('=HYPERLINK("http://x.example.test","a")')).toBe(`"'=HYPERLINK(""http://x.example.test"",""a"")"`);
  });

  it('leaves numbers, booleans, dates and plain text alone', () => {
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(csvCell('echo hi')).toBe('echo hi');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks and doubles the quotes (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
  });

  it('ends a row with CRLF', () => {
    expect(csvRow(['a', 1, null, '=x'])).toBe("a,1,,'=x\r\n");
  });
});
