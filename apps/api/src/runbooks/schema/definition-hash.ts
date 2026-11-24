// The content hash of a normalised definition (issue #61): sha256 over its canonical JSON
// (keys sorted at every level), so two definitions that differ only in key order or whitespace
// hash the same and a PUT of an unchanged definition creates no new version.

import { createHash } from 'node:crypto';

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonicalise(item);
    }
    return out;
  }
  return value;
}

/** The canonical JSON text of a value: sorted keys, no whitespace, `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/** Lower-case hex sha256 (64 characters) of the canonical JSON of `definition`. */
export function definitionSha256(definition: unknown): string {
  return createHash('sha256').update(canonicalJson(definition)).digest('hex');
}
