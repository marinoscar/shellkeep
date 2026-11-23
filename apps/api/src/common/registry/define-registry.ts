// =============================================================================
// Local registry primitive
// =============================================================================
//
// A small copy of the semantics of the platform's registry primitive
// (`packages/platform-api/src/core/registry` in the platform repository), so
// base modules can declare extension points that the domain fills at import
// time without importing the domain. #47 swaps this for the package's
// `defineRegistry`; the API below is the subset ShellKeep uses.
//
//   - ids match a pattern (default: letter or digit first, then letters,
//     digits and `. _ : / @ -`) and are at most 128 characters
//   - a duplicate id throws `DUPLICATE_ID`; `registerAll` is all-or-nothing
//   - `list()` returns entries in registration order
//   - `freeze()` refuses every later write (`FROZEN`)
//
// FRAMEWORK-FREE ON PURPOSE: no `@nestjs/*`, no Prisma, so `prisma/seed.ts`
// and DTO modules can read a registry where no Nest container exists.
// =============================================================================

export const DEFAULT_REGISTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

export const REGISTRY_ID_MAX_LENGTH = 128;

export type RegistryErrorCode =
  | 'INVALID_ID'
  | 'INVALID_ENTRY'
  | 'DUPLICATE_ID'
  | 'FROZEN'
  | 'UNKNOWN_ID'
  | 'DUPLICATE_REGISTRY';

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly registry: string;
  readonly id?: string;

  constructor(
    code: RegistryErrorCode,
    registry: string,
    message: string,
    details: { id?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RegistryError';
    this.code = code;
    this.registry = registry;
    if (details.id !== undefined) this.id = details.id;
  }
}

export interface RegistryOptions<T> {
  /** Unique name used in errors and introspection. */
  name: string;
  /** Extracts the entry's id. */
  idOf: (entry: T) => string;
  /** Pattern every id must match. Default {@link DEFAULT_REGISTRY_ID_PATTERN}. */
  idPattern?: RegExp;
  /** Rejects an entry by throwing; wrapped as `INVALID_ENTRY`. */
  validate?: (entry: T) => void;
  /** Custom `DUPLICATE_ID` message. */
  describeDuplicate?: (existing: T, incoming: T) => string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class Registry<T> {
  readonly name: string;

  private entries = new Map<string, T>();
  private isFrozen = false;
  private readonly idPattern: RegExp;

  constructor(private readonly options: RegistryOptions<T>) {
    if (typeof options.name !== 'string' || options.name.trim() === '') {
      throw new RegistryError(
        'INVALID_ID',
        String(options.name),
        'A registry name must be a non-empty string.',
      );
    }
    this.name = options.name;
    const pattern = options.idPattern ?? DEFAULT_REGISTRY_ID_PATTERN;
    this.idPattern = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  }

  register(entry: T): void {
    this.registerAll([entry]);
  }

  /** Adds every entry or none: a failing entry leaves the registry unchanged. */
  registerAll(entries: readonly T[]): void {
    if (this.isFrozen) {
      throw new RegistryError(
        'FROZEN',
        this.name,
        `Registry "${this.name}" is frozen: entries are registered before the application bootstraps.`,
      );
    }

    const staged = new Map(this.entries);
    for (const entry of entries) {
      const id = this.checkedId(entry);

      if (this.options.validate) {
        try {
          this.options.validate(entry);
        } catch (err) {
          throw new RegistryError(
            'INVALID_ENTRY',
            this.name,
            `Invalid entry "${id}" in registry "${this.name}": ${messageOf(err)}`,
            { id, cause: err },
          );
        }
      }

      if (staged.has(id)) {
        const message = this.options.describeDuplicate
          ? this.options.describeDuplicate(staged.get(id) as T, entry)
          : `Duplicate id "${id}" in registry "${this.name}".`;
        throw new RegistryError('DUPLICATE_ID', this.name, message, { id });
      }
      staged.set(id, entry);
    }
    this.entries = staged;
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  require(id: string): T {
    if (!this.entries.has(id)) {
      throw new RegistryError(
        'UNKNOWN_ID',
        this.name,
        `Unknown id "${id}" in registry "${this.name}". Known ids: ${this.ids().join(', ') || '(none)'}.`,
        { id },
      );
    }
    return this.entries.get(id) as T;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Every entry, as a fresh array, in registration order. */
  list(): T[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }

  /** Refuses every later write with `FROZEN`. Reads keep working. Idempotent. */
  freeze(): void {
    this.isFrozen = true;
  }

  get frozen(): boolean {
    return this.isFrozen;
  }

  private checkedId(entry: T): string {
    const id: unknown = this.options.idOf(entry);
    const fail = (why: string): never => {
      throw new RegistryError(
        'INVALID_ID',
        this.name,
        `Invalid id ${JSON.stringify(id)} in registry "${this.name}": ${why}.`,
        { id: typeof id === 'string' ? id : undefined },
      );
    };

    if (typeof id !== 'string') return fail('an id must be a string');
    if (id.length === 0) return fail('an id must not be empty');
    if (id.length > REGISTRY_ID_MAX_LENGTH) {
      return fail(`an id must be at most ${REGISTRY_ID_MAX_LENGTH} characters`);
    }
    if (!this.idPattern.test(id)) return fail(`an id must match ${this.idPattern}`);
    return id;
  }
}

const definedRegistries = new Map<string, Registry<unknown>>();

/**
 * Creates a module-level registry and records it, so
 * {@link freezeDefinedRegistries} freezes it after bootstrap.
 *
 * @throws RegistryError `DUPLICATE_REGISTRY` when the name is already used.
 */
export function defineRegistry<T>(options: RegistryOptions<T>): Registry<T> {
  if (definedRegistries.has(options.name)) {
    throw new RegistryError(
      'DUPLICATE_REGISTRY',
      options.name,
      `A registry named "${options.name}" is already defined. Registry names must be unique.`,
    );
  }
  const registry = new Registry<T>(options);
  definedRegistries.set(registry.name, registry as Registry<unknown>);
  return registry;
}

export function listDefinedRegistries(): ReadonlyArray<Registry<unknown>> {
  return [...definedRegistries.values()];
}

/** Freezes every registry created with {@link defineRegistry}. Idempotent. */
export function freezeDefinedRegistries(): void {
  for (const registry of definedRegistries.values()) registry.freeze();
}
