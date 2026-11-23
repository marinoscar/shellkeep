/**
 * Smoke test: the pinned platform packages resolve through their `exports`
 * maps. No application code imports them yet.
 */
describe('platform packages resolve', () => {
  it('resolves @marinoscar/platform-api/core', async () => {
    const core = await import('@marinoscar/platform-api/core');
    expect(Object.keys(core).length).toBeGreaterThan(0);
  });

  it('resolves @marinoscar/platform-contract', async () => {
    const contract = await import('@marinoscar/platform-contract');
    expect(Object.keys(contract).length).toBeGreaterThan(0);
  });
});
