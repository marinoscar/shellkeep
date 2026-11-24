import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESTINATIONS,
  DESTINATION_ROUTES,
  UNOWNED_ROUTES,
  isDestinationVisible,
  owns,
  resolveActiveDestination,
} from '../../config/destinations';
import { SHELLKEEP_NAVIGATION } from '../../config/shell';
import { ADMIN_SECTIONS } from '../../config/adminSections';

/**
 * The destination table (#76). The platform's `settings-route-ownership`
 * conformance suite checks the general invariants; this file pins ShellKeep's
 * own data: the order, the gates, and that the table and `App.tsx` agree.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = readFileSync(resolve(HERE, '../../App.tsx'), 'utf8');

/** Every `<Route path="...">` of `App.tsx`, except the catch-all. */
const ROUTED_PATHS = [...APP_TSX.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== '*');

const holds =
  (...granted: string[]) =>
  (permission: string) =>
    granted.includes(permission);

describe('DESTINATIONS', () => {
  it('declares Home, Sessions, Servers, the pinned Console and the AI Playground, in that order', () => {
    expect(DESTINATIONS.map((d) => [d.key, d.label, d.compactLabel, d.path])).toEqual([
      ['home', 'Home', 'Home', '/'],
      ['sessions', 'Sessions', 'Sessions', '/sessions'],
      ['servers', 'Servers', 'Servers', '/servers'],
      ['console', 'Console', 'Console', '/admin/settings'],
      // #55: appended, so the existing destinations keep their positions.
      ['ai', 'AI Playground', 'AI', '/ai'],
    ]);
    expect(DESTINATIONS.filter((d) => d.pinned).map((d) => d.key)).toEqual(['console']);
  });

  it('gates on the exact strings the API enforces, never on a role', () => {
    expect(DESTINATIONS.map((d) => [d.key, d.permission ?? null, d.anyPermission ?? null])).toEqual([
      ['home', null, null],
      ['sessions', 'sessions:read', null],
      ['servers', 'servers:read', null],
      ['console', null, ['system_settings:read', 'users:read']],
      ['ai', 'ai:use', null],
    ]);
    // Hidden while the AI kill switch is off.
    expect(DESTINATIONS.filter((d) => d.feature).map((d) => [d.key, d.feature])).toEqual([['ai', 'ai']]);
    for (const d of DESTINATIONS) expect(d).not.toHaveProperty('role');
  });

  it('declares no Runbooks or Runs until #61 ships their API (#65 appends them)', () => {
    const keys = DESTINATIONS.map((d) => d.key);
    expect(keys).not.toContain('runbooks');
    expect(keys).not.toContain('runs');
    expect(DESTINATION_ROUTES.runbooks).toEqual([]);
    expect(DESTINATION_ROUTES.runs).toEqual([]);
  });

  it('shows a viewer only what their permissions reach', () => {
    const visible = (granted: string[]) =>
      DESTINATIONS.filter((d) => isDestinationVisible(d, holds(...granted))).map((d) => d.key);
    expect(visible([])).toEqual(['home']);
    expect(visible(['sessions:read', 'servers:read'])).toEqual(['home', 'sessions', 'servers']);
    expect(visible(['sessions:read', 'servers:read', 'users:read'])).toEqual([
      'home',
      'sessions',
      'servers',
      'console',
    ]);
    expect(visible(['system_settings:read'])).toEqual(['home', 'console']);
  });

  it('shows the AI Playground only with ai:use and AI switched on (#55)', () => {
    const keys = (granted: string[], features: { ai?: boolean }) =>
      DESTINATIONS.filter((d) => isDestinationVisible(d, holds(...granted), features)).map((d) => d.key);
    expect(keys(['ai:use'], { ai: true })).toEqual(['home', 'ai']);
    expect(keys(['ai:use'], { ai: false })).toEqual(['home']);
    expect(keys(['ai:use'], {})).toEqual(['home']);
    expect(keys([], { ai: true })).toEqual(['home']);
  });
});

describe('route ownership', () => {
  it('finds the routes of App.tsx (the scan is not vacuous)', () => {
    expect(ROUTED_PATHS).toContain('/');
    expect(ROUTED_PATHS).toContain('/sessions/:id');
    expect(ROUTED_PATHS).toContain('/admin/settings');
    expect(ROUTED_PATHS.length).toBeGreaterThan(20);
  });

  it('routes every DESTINATION_ROUTES prefix and every destination path in App.tsx', () => {
    const prefixes = Object.values(DESTINATION_ROUTES).flat();
    for (const prefix of prefixes) {
      expect(
        ROUTED_PATHS.some((path) => owns(prefix, path)),
        `${prefix} owns no route of App.tsx`,
      ).toBe(true);
    }
    for (const d of DESTINATIONS) expect(ROUTED_PATHS).toContain(d.path);
  });

  it('owns every routed path exactly once, or lists it as unowned', () => {
    const failures: string[] = [];
    for (const path of ROUTED_PATHS) {
      const owners = Object.entries(DESTINATION_ROUTES)
        .filter(([, prefixes]) => prefixes.some((prefix) => owns(prefix, path)))
        .map(([key]) => key);
      if (UNOWNED_ROUTES.includes(path)) {
        if (owners.length > 0) failures.push(`${path} is unowned but claimed by ${owners.join(', ')}`);
      } else if (owners.length !== 1) {
        failures.push(`${path} has owners [${owners.join(', ')}]`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('lights the right destination', () => {
    expect(resolveActiveDestination('/')).toBe('home');
    expect(resolveActiveDestination('/sessions')).toBe('sessions');
    expect(resolveActiveDestination('/sessions/abc')).toBe('sessions');
    expect(resolveActiveDestination('/terminal/abc')).toBe('sessions');
    expect(resolveActiveDestination('/servers')).toBe('servers');
    expect(resolveActiveDestination('/admin')).toBe('console');
    expect(resolveActiveDestination('/admin/settings/users')).toBe('console');
    expect(resolveActiveDestination('/admin/users')).toBe('console');
    // The per-user settings sit with Home (they are reached from the user menu).
    expect(resolveActiveDestination('/settings/profile')).toBe('home');
    expect(resolveActiveDestination('/login')).toBeNull();
    expect(resolveActiveDestination('/sessionsfoo')).toBeNull();
  });

  it('keeps the sign-in flow unowned', () => {
    expect(UNOWNED_ROUTES).toEqual(['/login', '/auth/callback', '/auth/error', '/activate', '/testing/login']);
    for (const path of UNOWNED_ROUTES) expect(resolveActiveDestination(path)).toBeNull();
  });
});

describe('SHELLKEEP_NAVIGATION', () => {
  it('binds the destination table and both settings surfaces, Console first', () => {
    expect(SHELLKEEP_NAVIGATION.destinations).toBe(DESTINATIONS);
    expect(SHELLKEEP_NAVIGATION.destinationRoutes).toBe(DESTINATION_ROUTES);
    expect(SHELLKEEP_NAVIGATION.settingsSurfaces?.map((s) => [s.hubPath, s.hubTitle])).toEqual([
      ['/admin/settings', 'Console'],
      ['/settings', 'Settings'],
    ]);
  });

  it('turns on Console mode under /admin, with a way back to ShellKeep', () => {
    expect(SHELLKEEP_NAVIGATION.console).toEqual({
      prefix: '/admin',
      sections: ADMIN_SECTIONS,
      back: { label: 'Back to ShellKeep', path: '/' },
    });
    expect(typeof SHELLKEEP_NAVIGATION.useRailPreference).toBe('function');
  });
});
