import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppRoutes } from '@marinoscar/platform-web/settings/testing';
import { MAINTENANCE_ADMIN_PATH } from '@marinoscar/platform-web/host/headless';
import {
  ADMIN_HUB_PATH,
  ADMIN_HUB_PERMISSIONS,
  ADMIN_SECTIONS,
  MAINTENANCE_PATH,
} from '../../config/adminSections';

const cards = ADMIN_SECTIONS.flatMap((s) => s.cards);
const routes = parseAppRoutes(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8'));

describe('ADMIN_SECTIONS (#46)', () => {
  it('declares About, Maintenance, Terminal, Users & Allowlist and Doctor', () => {
    expect(cards.map((c) => [c.title, c.path])).toEqual([
      ['About', '/admin/settings/about'],
      ['Maintenance', '/admin/settings/maintenance'],
      ['Terminal', '/admin/settings/terminal'],
      ['Users & Allowlist', '/admin/settings/users'],
      ['Doctor', '/admin/settings/doctor'],
    ]);
  });

  it('gates each card on the exact permission its API controller enforces', () => {
    expect(Object.fromEntries(cards.map((c) => [c.path, c.permission]))).toEqual({
      // GET /api/admin/about (AboutModule): system_settings:read, no about:read.
      '/admin/settings/about': 'system_settings:read',
      // GET /api/admin/maintenance; the PUT's system_settings:write is gated in the page.
      '/admin/settings/maintenance': 'system_settings:read',
      // GET /api/system-settings; saving needs system_settings:write, gated in the page.
      '/admin/settings/terminal': 'system_settings:read',
      // GET /api/users.
      '/admin/settings/users': 'users:read',
      // GET /api/admin/doctor.
      '/admin/settings/doctor': 'system_settings:read',
    });
  });

  it('puts Maintenance on the path MaintenanceGate never gates', () => {
    expect(MAINTENANCE_PATH).toBe(MAINTENANCE_ADMIN_PATH);
  });

  it('has a route in App.tsx for every card, gated on the card permission', () => {
    for (const card of cards) {
      const route = routes.find((r) => r.path === card.path);
      expect(route, card.path).toBeDefined();
      expect(route?.permission, card.path).toEqual(card.permission);
    }
  });

  it('gates the hub on any card permission', () => {
    expect(ADMIN_HUB_PERMISSIONS.sort()).toEqual(['system_settings:read', 'users:read']);
    const hub = routes.find((r) => r.path === ADMIN_HUB_PATH);
    expect([...((hub?.permission as readonly string[]) ?? [])].sort()).toEqual(ADMIN_HUB_PERMISSIONS);
  });

  it('has a card for every /admin/settings/* route', () => {
    const adminRoutes = routes
      .filter((r) => r.path.startsWith(`${ADMIN_HUB_PATH}/`))
      .map((r) => r.path);
    expect(adminRoutes.sort()).toEqual(cards.map((c) => c.path).sort());
  });
});
