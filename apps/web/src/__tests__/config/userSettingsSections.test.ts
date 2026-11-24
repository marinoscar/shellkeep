import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppRoutes } from '@marinoscar/platform-web/settings/testing';
import { USER_SETTINGS_SECTIONS, USER_HUB_PATH } from '../../config/userSettingsSections';

const cards = USER_SETTINGS_SECTIONS.flatMap((s) => s.cards);
const routes = parseAppRoutes(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8'));

describe('USER_SETTINGS_SECTIONS', () => {
  it('declares the Profile, Appearance, Notifications, Terminal, Access Tokens, AI Keys and Webhooks cards', () => {
    expect(cards.map((c) => [c.title, c.path])).toEqual([
      ['Profile', '/settings/profile'],
      ['Appearance', '/settings/appearance'],
      // #51: appended to Account.
      ['Notifications', '/settings/notifications'],
      ['Terminal', '/settings/terminal'],
      // #76: the identity slice's Security card, appended.
      ['Access Tokens', '/settings/tokens'],
      // #55: appended to Security.
      ['AI Keys', '/settings/ai'],
      // #54: the webhooks slice's Integrations card, appended.
      ['Webhooks', '/settings/webhooks'],
    ]);
  });

  it('declares no card permission but AI Keys and Webhooks (user_settings:* is every role\'s)', () => {
    // `ai:use` is the `/api/ai/keys` controller's string and `webhooks:read` the one `/api/webhooks` enforces.
    expect(cards.filter((c) => c.permission !== undefined).map((c) => [c.path, c.permission, c.feature ?? null])).toEqual([
      ['/settings/ai', 'ai:use', 'ai'],
      ['/settings/webhooks', 'webhooks:read', null],
    ]);
  });

  it('has a route in App.tsx for the hub and every card, gated exactly as the card is', () => {
    for (const path of [USER_HUB_PATH, ...cards.map((c) => c.path)]) {
      const route = routes.find((r) => r.path === path);
      const card = cards.find((c) => c.path === path);
      expect(route, path).toBeDefined();
      expect(route?.permission ?? null, path).toEqual(card?.permission ?? null);
    }
  });

  it('has a card for every /settings/* route', () => {
    const settingsRoutes = routes.filter((r) => r.path.startsWith(`${USER_HUB_PATH}/`)).map((r) => r.path);
    expect(settingsRoutes.sort()).toEqual(cards.map((c) => c.path).sort());
  });
});
