import {
  Registry,
  RegistryError,
  defineRegistry,
  freezeDefinedRegistries,
  listDefinedRegistries,
} from './define-registry';

interface Entry {
  id: string;
}

const make = (extra: Partial<ConstructorParameters<typeof Registry<Entry>>[0]> = {}) =>
  new Registry<Entry>({ name: 'test', idOf: (e) => e.id, ...extra });

const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    return (err as RegistryError).code;
  }
  return undefined;
};

describe('Registry', () => {
  it('lists entries in registration order', () => {
    const r = make();
    r.registerAll([{ id: 'b' }, { id: 'a' }]);
    r.register({ id: 'c' });
    expect(r.ids()).toEqual(['b', 'a', 'c']);
    expect(r.list().map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('throws DUPLICATE_ID on a repeated id, also within one batch', () => {
    const r = make();
    r.register({ id: 'a' });
    expect(codeOf(() => r.register({ id: 'a' }))).toBe('DUPLICATE_ID');
    expect(codeOf(() => r.registerAll([{ id: 'x' }, { id: 'x' }]))).toBe('DUPLICATE_ID');
    expect(r.ids()).toEqual(['a']);
  });

  it('rejects ids that do not match the pattern', () => {
    const r = make({ idPattern: /^[a-z]+$/ });
    expect(codeOf(() => r.register({ id: 'A1' }))).toBe('INVALID_ID');
    expect(codeOf(() => r.register({ id: '' }))).toBe('INVALID_ID');
    expect(codeOf(() => r.register({ id: 'a'.repeat(129) }))).toBe('INVALID_ID');
  });

  it('wraps a validate throw as INVALID_ENTRY and stays unchanged', () => {
    const r = make({
      validate: (e) => {
        if (e.id === 'bad') throw new Error('nope');
      },
    });
    expect(codeOf(() => r.registerAll([{ id: 'ok' }, { id: 'bad' }]))).toBe('INVALID_ENTRY');
    expect(r.size).toBe(0);
  });

  it('refuses writes after freeze but still reads', () => {
    const r = make();
    r.register({ id: 'a' });
    r.freeze();
    expect(r.frozen).toBe(true);
    expect(codeOf(() => r.register({ id: 'b' }))).toBe('FROZEN');
    expect(r.has('a')).toBe(true);
    expect(codeOf(() => r.require('zzz'))).toBe('UNKNOWN_ID');
  });
});

describe('defineRegistry', () => {
  it('rejects a duplicate registry name and freezes defined registries', () => {
    const r = defineRegistry<Entry>({ name: 'define-registry-spec', idOf: (e) => e.id });
    expect(
      codeOf(() => defineRegistry<Entry>({ name: 'define-registry-spec', idOf: (e) => e.id })),
    ).toBe('DUPLICATE_REGISTRY');
    expect(listDefinedRegistries()).toContain(r);
    freezeDefinedRegistries();
    expect(r.frozen).toBe(true);
  });
});
