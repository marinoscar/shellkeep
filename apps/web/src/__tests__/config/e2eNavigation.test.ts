import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESTINATIONS } from '../../config/destinations';

/**
 * `tests/e2e/specs/navigation.spec.ts` (issue #81) visits every destination of
 * the shell against the running stack. It cannot import the destination table
 * (the e2e project is its own package), so this guard keeps the two honest: a
 * destination added to `config/destinations.ts` without a route in that spec
 * fails here, in the fast suite, not months later in the slow one.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(resolve(HERE, '../../../../../tests/e2e/specs/navigation.spec.ts'), 'utf8');

/** The quoted routes of the spec's `DESTINATION_ROUTES` list. */
const LISTED = new Set(
  [...(SPEC.match(/DESTINATION_ROUTES = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  ),
);

describe('e2e navigation spec', () => {
  it('lists routes at all', () => {
    expect(LISTED.size).toBeGreaterThan(5);
  });

  it('visits every destination of the shell', () => {
    // The AI Playground exists only while AI is on (`feature: 'ai'`), which the
    // stack under test does not configure; it is covered by its own tests.
    const missing = DESTINATIONS.filter((destination) => destination.key !== 'ai')
      .map((destination) => destination.path)
      .filter((path) => !LISTED.has(path));
    expect(missing).toEqual([]);
  });
});
