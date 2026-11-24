import { LiveSessionResetListener } from './live-session-reset.listener';

describe('LiveSessionResetListener', () => {
  const event = (type: string, succeeded = true) => ({ type, succeeded }) as any;
  const build = () => {
    const reconciler = { reconcile: jest.fn().mockResolvedValue(0) };
    return { reconciler, listener: new LiveSessionResetListener(reconciler as any) };
  };

  it.each(['admin.factory_reset', 'user.data.purge', 'org.offboard'])('reconciles after a successful %s', async (type) => {
    const { reconciler, listener } = build();
    await listener.handle(event(type));
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
  });

  it('ignores other job types and failed jobs', async () => {
    const { reconciler, listener } = build();
    await listener.handle(event('terminal.session.reap'));
    await listener.handle(event('admin.factory_reset', false));
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('swallows a reconcile failure', async () => {
    const { reconciler, listener } = build();
    reconciler.reconcile.mockRejectedValue(new Error('boom'));
    await expect(listener.handle(event('user.data.purge'))).resolves.toBeUndefined();
  });
});
