import { describe, expect, it } from 'vitest';

/**
 * Smoke test: the pinned platform-web package resolves through its `exports`
 * map. No application code imports it yet.
 */
describe('platform packages resolve', () => {
  it('resolves @marinoscar/platform-web/core', async () => {
    const core = await import('@marinoscar/platform-web/core');
    expect(Object.keys(core).length).toBeGreaterThan(0);
  });
});
