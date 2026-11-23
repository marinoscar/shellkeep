// =============================================================================
// User settings namespace registry
// =============================================================================
//
// `theme` and `profile` are core fields of `user_settings.value`. Everything
// else is an OPTIONAL NAMESPACE (a top-level key owned by a domain module) declared
// once beside the module that owns it and registered at import time by
// `src/shellkeep.manifest.ts`. The base user-settings service, the DTOs and
// the default settings are composed from this registry, so base code never
// names a domain namespace (`test/architecture/base-domain-boundary.spec.ts`).
//
// The `UserSettingsNamespace` shape follows the platform's
// (`packages/platform-api/src/settings/registry/user-settings-namespace.ts`):
// #48 swaps this local registry for the package's.
//
// A namespace is always `.optional()` in the composed schemas: a stored value
// without it is valid, and reads fill `defaults` without writing.
// =============================================================================

import { z } from 'zod';
import { defineRegistry } from '../../common/registry/define-registry';
import { DEFAULT_USER_SETTINGS } from '../../common/types/settings.types';

/**
 * Typed namespaces of a user's settings. A domain module augments this
 * interface (`declare module`) so `UserSettingsValue` knows its namespace.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UserSettingsNamespaces {}

/**
 * One optional namespace of a user's settings document.
 *
 * @typeParam V - the stored value type.
 * @typeParam P - the parsed PATCH body branch `merge` receives.
 */
export interface UserSettingsNamespace<V = any, P = any> {
  /** Top-level key in `user_settings.value`. Matches `/^[a-z][A-Za-z0-9]*$/`. */
  readonly key: string;
  /** One sentence on what the namespace holds. */
  readonly description: string;
  /** The stored shape (also the PUT body branch); composed with `.optional()`. */
  readonly schema: z.ZodType<V>;
  /** The PATCH body branch; composed with `.optional()`. */
  readonly patchSchema: z.ZodType<P>;
  /** The value a user without the namespace reads (merged per field on every read). */
  readonly defaults: V;
  /**
   * Applies a parsed PATCH branch to the current value. `current` is the value
   * a read returns (defaults already filled); `patch` is `undefined` when the
   * body does not mention the namespace.
   */
  merge(current: V | undefined, patch: P | undefined): V | undefined;
}

export const USER_SETTINGS_NAMESPACE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/** Top-level keys the stored value or the response reserve for core fields. */
export const RESERVED_USER_SETTINGS_KEYS = [
  'theme',
  'profile',
  'updatedAt',
  'version',
] as const;

export const userSettingsNamespaceRegistry = defineRegistry<UserSettingsNamespace>({
  name: 'user-settings-namespaces',
  idOf: (ns) => ns.key,
  idPattern: USER_SETTINGS_NAMESPACE_KEY_PATTERN,
  validate: (ns) => {
    if (typeof ns.description !== 'string' || ns.description.trim() === '') {
      throw new Error('description is required');
    }
    for (const field of ['schema', 'patchSchema'] as const) {
      if (typeof (ns[field] as { safeParse?: unknown })?.safeParse !== 'function') {
        throw new Error(`${field} must be a zod schema`);
      }
    }
    if (typeof ns.merge !== 'function') throw new Error('merge is required');
    if (ns.defaults === undefined) throw new Error('defaults is required');
    if ((RESERVED_USER_SETTINGS_KEYS as readonly string[]).includes(ns.key)) {
      throw new Error(`"${ns.key}" is a core field of user settings, not a namespace`);
    }
  },
  describeDuplicate: (_existing, incoming) =>
    `User settings namespace "${incoming.key}" is already registered.`,
});

/**
 * Registers user settings namespaces, all or nothing. Registration order is
 * the key order of the composed schemas and of the stored value: append, never
 * insert. Also extends `DEFAULT_USER_SETTINGS`, the default document a new user
 * is created with.
 *
 * @throws RegistryError when one is invalid, a duplicate or the registry is frozen.
 */
export function registerUserSettingsNamespaces(
  namespaces: readonly UserSettingsNamespace[],
): void {
  userSettingsNamespaceRegistry.registerAll(namespaces);
  const defaults = DEFAULT_USER_SETTINGS as unknown as Record<string, unknown>;
  for (const ns of namespaces) defaults[ns.key] = ns.defaults;
}

/** The registered namespaces, in registration order. */
export function listUserSettingsNamespaces(): UserSettingsNamespace[] {
  return userSettingsNamespaceRegistry.list();
}

// -----------------------------------------------------------------------------
// Composition
// -----------------------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Deep-merges `stored` over `defaults`: a field the stored value lacks (or has
 * as `null`) takes the default; nested plain objects merge recursively; arrays
 * and scalars are taken whole. Key order is the defaults' order, then any extra
 * stored keys.
 */
export function mergeNamespaceDefaults<V>(defaults: V, stored: unknown): V {
  if (!isPlainObject(defaults)) return (stored ?? defaults) as V;
  const source = isPlainObject(stored) ? stored : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaults)) {
    const value = source[key];
    out[key] =
      value === undefined || value === null
        ? defaults[key]
        : mergeNamespaceDefaults(defaults[key], value);
  }
  for (const key of Object.keys(source)) {
    if (!(key in out)) out[key] = source[key];
  }
  return out as V;
}

function assertRegistered(): UserSettingsNamespace[] {
  const namespaces = listUserSettingsNamespaces();
  if (namespaces.length === 0) {
    throw new Error(
      'User settings namespaces are not registered: import src/shellkeep.manifest first.',
    );
  }
  return namespaces;
}

const coreProfileShape = {
  displayName: z.string().max(100).optional(),
  useProviderImage: z.boolean(),
  customImageUrl: z.string().url().nullable().optional(),
};

/**
 * The stored shape of `user_settings.value` and the PUT body: core fields, then
 * one optional key per namespace. Composed when first called, so the manifest
 * must have been imported.
 */
export function composeUserSettingsSchema() {
  const shape: Record<string, z.ZodType> = {
    theme: z.enum(['light', 'dark', 'system']),
    profile: z.object(coreProfileShape),
  };
  for (const ns of assertRegistered()) shape[ns.key] = ns.schema.optional();
  return z.object(shape);
}

/** The PATCH body: every core field optional, one optional key per namespace. */
export function composeUserSettingsPatchSchema() {
  const shape: Record<string, z.ZodType> = {
    theme: z.enum(['light', 'dark', 'system']).optional(),
    profile: z
      .object({
        displayName: coreProfileShape.displayName,
        useProviderImage: z.boolean().optional(),
        customImageUrl: coreProfileShape.customImageUrl,
      })
      .optional(),
  };
  for (const ns of assertRegistered()) shape[ns.key] = ns.patchSchema.optional();
  return z.object(shape);
}
