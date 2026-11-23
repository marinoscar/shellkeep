// =============================================================================
// TerminalMaintenancePolicy (issue #46)
// =============================================================================
//
// The window rules the platform's `MaintenanceGuard` applies to HTTP, applied to
// the terminal WebSocket: no window, the admin rule, the registered bypasses
// (fail closed) and an unreadable window (fail open). The maintenance bypass
// registry is static, so the two bypasses below are registered once, at import
// time, before any application boots; they key on the subject's user id so each
// case picks its behaviour.
// =============================================================================

import { registerMaintenanceBypass, type MaintenanceModeService } from '@marinoscar/platform-api/host';

import { TerminalMaintenancePolicy } from './terminal-maintenance.policy';

const BYPASSED = 'user-bypassed';
const BYPASS_THROWS = 'user-bypass-throws';
const BYPASS_TRUTHY = 'user-bypass-truthy';

registerMaintenanceBypass({
  id: 'spec-terminal',
  allows: (request, principal) => {
    if (principal.userId === BYPASS_THROWS) throw new Error('boom');
    if (principal.userId === BYPASS_TRUTHY) return 'yes' as unknown as boolean;
    // The terminal WebSocket is seen as a GET of its own path, with a verified session principal.
    return principal.userId === BYPASSED && request.method === 'GET' && request.path === '/api/terminal/ws' && principal.kind === 'session';
  },
});

const stateOf = (overrides: { enabled?: boolean; allowAdmins?: boolean } = {}) =>
  ({ enabled: true, allowAdmins: true, ...overrides }) as Awaited<ReturnType<MaintenanceModeService['resolve']>>;

const policyWith = (resolve: () => Promise<unknown>) =>
  new TerminalMaintenancePolicy({ resolve } as unknown as MaintenanceModeService);

describe('TerminalMaintenancePolicy', () => {
  const contributor = { userId: 'user-1', roles: ['contributor'] };
  const admin = { userId: 'user-2', roles: ['admin', 'org_admin'] };

  it('allows everyone while no window is open', async () => {
    const policy = policyWith(async () => stateOf({ enabled: false }));
    expect(await policy.refuses(contributor)).toBe(false);
    expect(await policy.refuses(admin)).toBe(false);
  });

  it('refuses a non-admin during a window', async () => {
    expect(await policyWith(async () => stateOf()).refuses(contributor)).toBe(true);
  });

  it('lets a system administrator through when the window allows admins', async () => {
    expect(await policyWith(async () => stateOf({ allowAdmins: true })).refuses(admin)).toBe(false);
  });

  it('does not let an administrator through when the window does not allow admins', async () => {
    expect(await policyWith(async () => stateOf({ allowAdmins: false })).refuses(admin)).toBe(true);
  });

  it('does not treat an org admin as a system administrator', async () => {
    const orgAdmin = { userId: 'user-3', roles: ['org_admin'] };
    expect(await policyWith(async () => stateOf()).refuses(orgAdmin)).toBe(true);
  });

  it('lets a request through that a registered bypass allows', async () => {
    expect(await policyWith(async () => stateOf()).refuses({ userId: BYPASSED, roles: [] })).toBe(false);
  });

  it('fails closed when a bypass throws or answers anything but true', async () => {
    const policy = policyWith(async () => stateOf());
    expect(await policy.refuses({ userId: BYPASS_THROWS, roles: [] })).toBe(true);
    expect(await policy.refuses({ userId: BYPASS_TRUTHY, roles: [] })).toBe(true);
  });

  it('fails open when the window cannot be read, rather than turning a settings outage into a terminal outage', async () => {
    const policy = policyWith(async () => {
      throw new Error('settings unreadable');
    });
    expect(await policy.refuses(contributor)).toBe(false);
  });
});
