import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import JSZip from 'jszip';

import { buildBundleZip, safeSegment } from './bundle-builder';

describe('safeSegment', () => {
  it('keeps a name usable as one path segment', () => {
    expect(safeSegment('web-01.prod')).toBe('web-01.prod');
    expect(safeSegment('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeSegment('a b/c\\d\u0000e')).toBe('a_b_c_d_e');
    expect(safeSegment('...')).toBe('unnamed');
    expect(safeSegment('x'.repeat(200)).length).toBe(64);
    expect(safeSegment('')).toBe('unnamed');
  });
});

describe('buildBundleZip', () => {
  it('streams the inputs, then writes a manifest that matches every entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-zip-'));
    try {
      const out = join(dir, 'b.zip');
      const result = await buildBundleZip(
        [
          { path: 'srv__1/logs.tar.gz', store: true, open: async () => Readable.from([Buffer.from([1, 2, 3, 4])]) },
          { path: 'logs/srv__1/0.log', open: async () => Readable.from([Buffer.from('hello '), Buffer.from('world\n')]) },
        ],
        (entries) => ({ files: entries }),
        out,
      );
      const bytes = readFileSync(out);
      expect(result.sizeBytes).toBe(bytes.length);
      expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      const zip = await JSZip.loadAsync(bytes);
      expect(Object.keys(zip.files).sort()).toEqual(['logs/srv__1/0.log', 'manifest.json', 'srv__1/logs.tar.gz']);
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { files: Array<{ path: string; sha256: string; bytes: number }> };
      expect(manifest.files).toEqual([
        { path: 'srv__1/logs.tar.gz', sha256: createHash('sha256').update(Buffer.from([1, 2, 3, 4])).digest('hex'), bytes: 4 },
        { path: 'logs/srv__1/0.log', sha256: createHash('sha256').update('hello world\n').digest('hex'), bytes: 12 },
      ]);
      expect(await zip.file('logs/srv__1/0.log')!.async('string')).toBe('hello world\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes a valid zip with only a manifest, and fails (and aborts) when an input cannot be opened', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sk-zip-'));
    try {
      const empty = await buildBundleZip([], () => ({ files: [] }), join(dir, 'e.zip'));
      expect(empty.entries).toEqual([]);
      expect(Object.keys((await JSZip.loadAsync(readFileSync(join(dir, 'e.zip')))).files)).toEqual(['manifest.json']);
      await expect(
        buildBundleZip([{ path: 'x', open: async () => Promise.reject(new Error('gone')) }], () => ({}), join(dir, 'f.zip')),
      ).rejects.toThrow('gone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
