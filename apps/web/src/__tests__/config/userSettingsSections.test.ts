import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppRoutes } from '@marinoscar/platform-web/settings/testing';
import { USER_SETTINGS_SECTIONS, USER_HUB_PATH } from '../../config/userSettingsSections';

const cards = USER_SETTINGS_SECTIONS.flatMap((s) => s.cards);
const routes = parseAppRoutes(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8'));

describe('USER_SETTINGS_SECTIONS', () => {
  it('declares the Profile, Appearance, Notifications, Terminal, Keyboard shortcuts, Access Tokens and Webhooks cards', () => {
    expect(cards.map((c) => [c.title, c.path])).toEqual([
      ['Profile', '/settings/profile'],
      ['Appearance', '/settings/appearance'],
      // #51: appended to Account.
      ['Notifications', '/settings/notifications'],
      ['Terminal', '/settings/terminal'],
      // #80: appended to Workspace.
      ['Keyboard shortcuts', '/settings/shortcuts'],
      // #76: the identity slice's Security card, appended.
      ['Access Tokens', '/settings/tokens'],
      // #54: the webhooks slice's Integrations card, appended.
      ['Webhooks', '/settings/webhooks'],
    ]);
  });

  it('puts Terminal and Keyboard shortcuts in Workspace, with no permission (#80)', () => {
    const workspace = USER_SETTINGS_SECTIONS.find((s) => s.label === 'Workspace');
    expect(workspace?.cards.map((c) => [c.title, c.path, c.permission])).toEqual([
      ['Terminal', '/settings/terminal', undefined],
      ['Keyboard shortcuts', '/settings/shortcuts', undefined],
    ]);
  });

  it('declares no card permission but Webhooks (user_settings:* is every role\'s)', () => {
    // `webhooks:read` is the exact string `/api/webhooks` enforces (#54).
    expect(cards.filter((c) => c.permission !== undefined).map((c) => [c.path, c.permission])).toEqual([
      ['/settings/webhooks', 'webhooks:read'],
    ]);
  });

  it('has a route in App.tsx for the hub and every card, gated on the card permission', () => {
    for (const path of [USER_HUB_PATH, ...cards.map((c) => c.path)]) {
      const route = routes.find((r) => r.path === path);
      expect(route, path).toBeDefined();
      const card = cards.find((c) => c.path === path);
      expect(route?.permission ?? null, path).toEqual(card?.permission ?? null);
    }
  });

  it('has a card for every /settings/* route', () => {
    const settingsRoutes = routes.filter((r) => r.path.startsWith(`${USER_HUB_PATH}/`)).map((r) => r.path);
    expect(settingsRoutes.sort()).toEqual(cards.map((c) => c.path).sort());
  });
});
