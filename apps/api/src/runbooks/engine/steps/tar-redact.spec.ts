import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import * as tar from 'tar-stream';

import { ArchiveTooLargeError, flatEntryName, redactTarGz } from './tar-redact';

const SECRET = ['sentinel', 'value', Math.random().toString(36).slice(2, 10)].join('-');

async function buildTarGz(entries: Array<{ name: string; body?: string; type?: 'file' | 'directory' | 'symlink' }>): Promise<Buffer> {
  const pack = tar.pack();
  const parts: Buffer[] = [];
  const done = new Promise<void>((resolve) => {
    pack.on('data', (part: Buffer) => parts.push(part));
    pack.on('end', resolve);
  });
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const type = entry.type ?? 'file';
      const header = { name: entry.name, type, ...(type === 'symlink' ? { linkname: '/etc/passwd' } : {}) };
      if (type === 'file') pack.entry(header, entry.body ?? '', (error) => (error ? reject(error) : resolve()));
      else {
        pack.entry(header);
        resolve();
      }
    });
  }
  pack.finalize();
  await done;
  return gzipSync(Buffer.concat(parts));
}

async function untar(gz: Buffer): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const extract = tar.extract();
  const done = new Promise<void>((resolve) => {
    extract.on('entry', (header, stream, next) => {
      const parts: Buffer[] = [];
      stream.on('data', (part: Buffer) => parts.push(part));
      stream.on('end', () => {
        out.set(header.name, Buffer.concat(parts).toString());
        next();
      });
    });
    extract.on('finish', resolve);
  });
  Readable.from([gunzipSync(gz)]).pipe(extract);
  await done;
  return out;
}

describe('redactTarGz', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sk-tar-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = async (entries: Parameters<typeof buildTarGz>[0], over: Partial<Parameters<typeof redactTarGz>[2]> = {}) => {
    writeFileSync(join(dir, 'in.tar.gz'), await buildTarGz(entries));
    const result = await redactTarGz(join(dir, 'in.tar.gz'), join(dir, 'out.tar.gz'), { secrets: [SECRET], maxFileBytes: 1024 * 1024, maxUnpackedBytes: 10 * 1024 * 1024, ...over });
    return { result, out: readFileSync(join(dir, 'out.tar.gz')) };
  };

  it('removes the run secrets from every file, keeps the rest, and reports the new archive', async () => {
    const { result, out } = await run([
      { name: './', type: 'directory' },
      { name: './_var_log_a.log', body: `ok\nconnect ${SECRET} done\n` },
      { name: './_var_log_b.log', body: 'plain\n' },
    ]);
    const files = await untar(out);
    expect([...files.keys()].sort()).toEqual(['_var_log_a.log', '_var_log_b.log']);
    expect(files.get('_var_log_a.log')).toContain('connect ');
    expect(files.get('_var_log_a.log')).not.toContain(SECRET);
    expect(files.get('_var_log_b.log')).toBe('plain\n');
    expect(result.files).toBe(2);
    expect(result.sizeBytes).toBe(out.length);
    expect(result.sha256).toBe(createHash('sha256').update(out).digest('hex'));
    expect(result.entries.map((e) => e.name)).toEqual(['_var_log_a.log', '_var_log_b.log']);
  });

  it('counts zero files for an archive that holds nothing, and drops links and escaping names', async () => {
    expect((await run([{ name: './', type: 'directory' }])).result.files).toBe(0);
    const { result, out } = await run([
      { name: '../../etc/evil', body: 'x' },
      { name: './link', type: 'symlink' },
      { name: './dup', body: 'one' },
      { name: './dup', body: 'two' },
    ]);
    expect([...(await untar(out)).keys()].sort()).toEqual(['dup', 'etc/evil']);
    expect(result.files).toBe(2);
  });

  it('refuses a file or a total past its cap (a gzip bomb stops the unpack)', async () => {
    await expect(run([{ name: './big', body: 'x'.repeat(5000) }], { maxFileBytes: 1000 })).rejects.toBeInstanceOf(ArchiveTooLargeError);
    await expect(
      run([{ name: './a', body: 'x'.repeat(600) }, { name: './b', body: 'x'.repeat(600) }], { maxFileBytes: 1000, maxUnpackedBytes: 1000 }),
    ).rejects.toBeInstanceOf(ArchiveTooLargeError);
  });

  it('rejects bytes that are not a tar.gz', async () => {
    writeFileSync(join(dir, 'in.tar.gz'), Buffer.from('not an archive at all'));
    await expect(redactTarGz(join(dir, 'in.tar.gz'), join(dir, 'out.tar.gz'), { secrets: [], maxFileBytes: 10, maxUnpackedBytes: 10 })).rejects.toThrow();
  });

  it('normalises names', () => {
    expect(flatEntryName('./a/./b')).toBe('a/b');
    expect(flatEntryName('/abs/path')).toBe('abs/path');
    expect(flatEntryName('../..')).toBeNull();
    expect(flatEntryName('./')).toBeNull();
  });
});
