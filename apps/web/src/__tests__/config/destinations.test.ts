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

  it('gates User Management on the admin role only', () => {
    const gated = DESTINATIONS.filter((d) => d.permission || d.role).map((d) => d.id);
    expect(gated).toEqual(['user-management']);
  });
});

describe('isDestinationVisible', () => {
  const none = new Set<string>();

  it('shows an ungated destination to any viewer', () => {
    const d: AppDestination = { id: 'a', label: 'A', path: '/a', icon: Icon };
    expect(isDestinationVisible(d, none, none)).toBe(true);
  });

  it('requires the declared permission', () => {
    const d: AppDestination = { id: 'a', label: 'A', path: '/a', icon: Icon, permission: 'x:read' };
    expect(isDestinationVisible(d, none, none)).toBe(false);
    expect(isDestinationVisible(d, new Set(['x:read']), none)).toBe(true);
  });

  it('requires the declared role', () => {
    const d: AppDestination = { id: 'a', label: 'A', path: '/a', icon: Icon, role: 'admin' };
    expect(isDestinationVisible(d, none, none)).toBe(false);
    expect(isDestinationVisible(d, none, new Set(['admin']))).toBe(true);
  });

  it('requires both when both are declared', () => {
    const d: AppDestination = {
      id: 'a', label: 'A', path: '/a', icon: Icon, permission: 'x:read', role: 'admin',
    };
    expect(isDestinationVisible(d, new Set(['x:read']), none)).toBe(false);
    expect(isDestinationVisible(d, none, new Set(['admin']))).toBe(false);
    expect(isDestinationVisible(d, new Set(['x:read']), new Set(['admin']))).toBe(true);
  });
});
