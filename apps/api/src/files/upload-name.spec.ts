import { HttpException } from '@nestjs/common';

import { MAX_UPLOAD_NAME_BYTES, assertUploadName, uploadNameProblem, uploadTempName } from './upload-name';

describe('upload file names', () => {
  it.each(['a.txt', 'report 2026 (final).pdf', '.env', 'café.txt', 'x'.repeat(MAX_UPLOAD_NAME_BYTES), '..a', 'a..'])('accepts %j', (name) => {
    expect(uploadNameProblem(name)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['dot', '.'],
    ['dot dot', '..'],
    ['a slash', 'a/b'],
    ['a leading slash', '/etc/passwd'],
    ['a traversal', '../x'],
    ['a NUL byte', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['a DEL', 'a\u007fb'],
    ['too long', 'x'.repeat(MAX_UPLOAD_NAME_BYTES + 1)],
    ['too long in bytes', '€'.repeat(Math.floor(MAX_UPLOAD_NAME_BYTES / 3) + 1)],
    ['not a string', 42],
    ['missing', undefined],
  ])('refuses %s', (_label, name) => {
    expect(uploadNameProblem(name)).not.toBeNull();
  });

  it('throws FILE_NAME_INVALID with status 400', () => {
    try {
      assertUploadName('a/b');
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'FILE_NAME_INVALID' });
    }
  });

  it('builds a temp name that stays one segment under 255 bytes', () => {
    const temp = uploadTempName('x'.repeat(MAX_UPLOAD_NAME_BYTES), 'abcdef012345');
    expect(temp.startsWith('.')).toBe(true);
    expect(temp).toContain('.shellkeep-upload-abcdef012345');
    expect(temp.includes('/')).toBe(false);
    expect(Buffer.byteLength(temp)).toBeLessThanOrEqual(255);
  });
});
