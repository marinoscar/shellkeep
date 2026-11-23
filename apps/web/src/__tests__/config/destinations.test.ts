import { describe, it, expect } from 'vitest';
import { DESTINATIONS, isDestinationVisible, type AppDestination } from '../../config/destinations';

const Icon = () => null;

describe('DESTINATIONS', () => {
  it('declares the navigation destinations in display order', () => {
    expect(DESTINATIONS.map((d) => [d.id, d.label, d.path])).toEqual([
      ['dashboard', 'Dashboard', '/'],
      ['sessions', 'Sessions', '/sessions'],
      ['servers', 'Servers', '/servers'],
      ['user-management', 'User Management', '/admin/users'],
    ]);
  });

  it('has unique ids and paths', () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
    expect(new Set(DESTINATIONS.map((d) => d.path)).size).toBe(DESTINATIONS.length);
  });

  it('gates each destination on the permission its API enforces', () => {
    expect(DESTINATIONS.map((d) => [d.id, d.permission])).toEqual([
      ['dashboard', undefined],
      ['sessions', 'sessions:read'],
      ['servers', 'servers:read'],
      ['user-management', 'users:read'],
    ]);
  });

  it('gates nothing on a role name', () => {
    for (const d of DESTINATIONS) expect(d).not.toHaveProperty('role');
  });
});

describe('isDestinationVisible', () => {
  const holds = (...perms: string[]) => (p: string) => perms.includes(p);

  it('shows an ungated destination to any viewer', () => {
    const d: AppDestination = { id: 'a', label: 'A', path: '/a', icon: Icon };
    expect(isDestinationVisible(d, holds())).toBe(true);
  });

  it('requires the declared permission', () => {
    const d: AppDestination = { id: 'a', label: 'A', path: '/a', icon: Icon, permission: 'x:read' };
    expect(isDestinationVisible(d, holds())).toBe(false);
    expect(isDestinationVisible(d, holds('x:read'))).toBe(true);
  });

  it('shows User Management to a holder of users:read whatever the role names', () => {
    const d = DESTINATIONS.find((x) => x.id === 'user-management')!;
    expect(isDestinationVisible(d, holds('users:read'))).toBe(true);
    expect(isDestinationVisible(d, holds('sessions:read', 'servers:read'))).toBe(false);
  });
});
