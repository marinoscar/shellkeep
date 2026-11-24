// The identity notifier maps each identity notice onto its notification event (#51).
import { IdentityNotifierAdapter } from '../../src/platform/identity/identity-notifier.adapter';

describe('IdentityNotifierAdapter', () => {
  const notifications = { notify: jest.fn(async () => undefined), notifyAddress: jest.fn(async () => undefined) };
  const adapter = new IdentityNotifierAdapter(notifications as never);

  beforeEach(() => jest.clearAllMocks());

  it('maps roleChanged to security.role_changed for the user', async () => {
    const changedAt = new Date('2026-11-23T12:00:00Z');
    await adapter.roleChanged('user-1', {
      recipientEmail: 'person-a@example.test',
      previousRoles: ['viewer'],
      currentRoles: ['contributor'],
      changedAt,
      appUrl: 'https://app.example.test',
    } as never);
    expect(notifications.notify).toHaveBeenCalledWith('security.role_changed', 'user-1', {
      recipientEmail: 'person-a@example.test',
      previousRoles: ['viewer'],
      currentRoles: ['contributor'],
      changedAt,
      appUrl: 'https://app.example.test',
    });
  });

  it('maps userWelcomed to user.welcome and omits absent optional fields', async () => {
    await adapter.userWelcomed('user-1', { recipientEmail: 'person-a@example.test', roles: ['viewer'] } as never);
    expect(notifications.notify).toHaveBeenCalledWith('user.welcome', 'user-1', {
      recipientEmail: 'person-a@example.test',
      roles: ['viewer'],
    });
  });

  it('sends the allowlist invitation to the ADDRESS (the invitee has no account yet)', async () => {
    await adapter.allowlistInvitation('person-b@example.test', {
      recipientEmail: 'person-b@example.test',
      invitedBy: 'Person A',
      signInUrl: 'https://app.example.test/login',
    } as never);
    expect(notifications.notifyAddress).toHaveBeenCalledWith('allowlist.invitation', 'person-b@example.test', {
      recipientEmail: 'person-b@example.test',
      invitedBy: 'Person A',
      signInUrl: 'https://app.example.test/login',
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('logs and drops an organization invitation (single-organization mode)', async () => {
    await expect(adapter.orgInvitation('person-b@example.test', { orgName: 'Org Alpha' } as never)).resolves.toBeUndefined();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notifyAddress).not.toHaveBeenCalled();
  });
});
