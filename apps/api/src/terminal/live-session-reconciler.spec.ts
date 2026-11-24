import { LiveSessionReconciler } from './live-session-reconciler';

describe('LiveSessionReconciler', () => {
  const build = (live: string[], rows: Array<{ id: string; status: string }>) => {
    const prisma = { terminalSession: { findMany: jest.fn().mockResolvedValue(rows) } };
    const manager = { liveSessionIds: jest.fn().mockReturnValue(live), terminateSession: jest.fn().mockResolvedValue(undefined) };
    return { prisma, manager, reconciler: new LiveSessionReconciler(prisma as any, manager as any) };
  };

  it('closes only sessions whose row is missing or terminated, with one query', async () => {
    const { prisma, manager, reconciler } = build(['a', 'b', 'c', 'd'], [
      { id: 'a', status: 'active' },
      { id: 'b', status: 'terminated' },
      { id: 'd', status: 'detached' },
    ]);
    await expect(reconciler.reconcile()).resolves.toBe(2);
    expect(prisma.terminalSession.findMany).toHaveBeenCalledTimes(1);
    expect(manager.terminateSession.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']);
  });

  it('does nothing when no stream is held', async () => {
    const { prisma, reconciler } = build([], []);
    await expect(reconciler.reconcile()).resolves.toBe(0);
    expect(prisma.terminalSession.findMany).not.toHaveBeenCalled();
  });

  it('survives a throwing close and still closes the rest', async () => {
    const { manager, reconciler } = build(['a', 'b'], []);
    manager.terminateSession.mockRejectedValueOnce(new Error('boom'));
    await expect(reconciler.reconcile()).resolves.toBe(1);
    expect(manager.terminateSession).toHaveBeenCalledTimes(2);
  });

  it('never throws when the read fails', async () => {
    const { prisma, reconciler } = build(['a'], []);
    prisma.terminalSession.findMany.mockRejectedValue(new Error('db down'));
    await expect(reconciler.reconcile()).resolves.toBe(0);
  });
});
