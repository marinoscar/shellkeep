import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CATALOG_KEY_IDS,
  DEFAULT_KEY_LAYOUT,
  KEY_CATALOG,
  entrySpan,
  getCatalogKey,
  isChordKey,
  parseSequenceEscapes,
} from './keyModel';

describe('keyModel parity with the API copy', () => {
  it('is byte-identical to apps/api/src/terminal/settings/keys/key-model.ts', () => {
    const web = readFileSync(resolve(__dirname, 'keyModel.ts'), 'utf8');
    const api = readFileSync(
      resolve(__dirname, '../../../../../api/src/terminal/settings/keys/key-model.ts'),
      'utf8',
    );
    expect(api).toBe(web);
  });
});

describe('key catalog', () => {
  it('has unique ids and sane fields', () => {
    expect(new Set(CATALOG_KEY_IDS).size).toBe(KEY_CATALOG.length);
    for (const key of KEY_CATALOG) {
      expect(key.label).not.toBe('');
      expect([1, 2]).toContain(key.span);
    }
  });

  it('looks keys up by id', () => {
    expect(getCatalogKey('shift+tab')?.span).toBe(2);
    expect(getCatalogKey('ctrl')?.kind).toBe('modifier');
    expect(getCatalogKey('ai')?.kind).toBe('action');
    expect(getCatalogKey('nope')).toBeUndefined();
  });

  it('accepts named keys and one printable character as chord keys only', () => {
    for (const ok of ['Escape', 'F12', 'a', '%', '"', '\\']) expect(isChordKey(ok)).toBe(true);
    for (const bad of ['', 'ab', 'Nope', ' ', '\n']) expect(isChordKey(bad)).toBe(false);
  });
});

describe('default layout', () => {
  it('has four cells at most per group and known ids', () => {
    for (const group of DEFAULT_KEY_LAYOUT.groups) {
      expect(group.keys.reduce((n, e) => n + entrySpan(e), 0)).toBeLessThanOrEqual(4);
      for (const entry of group.keys) if ('id' in entry) expect(CATALOG_KEY_IDS).toContain(entry.id);
    }
  });
});

describe('parseSequenceEscapes', () => {
  it('parses the escapes and rejects bad ones', () => {
    expect(parseSequenceEscapes('\\e[A\\r')).toEqual({ ok: true, value: '\x1b[A\r' });
    expect(parseSequenceEscapes('\\x4')).toMatchObject({ ok: false });
    expect(parseSequenceEscapes('')).toMatchObject({ ok: false });
  });
});
