import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppRoutes } from '@marinoscar/platform-web/settings/testing';
import { USER_SETTINGS_SECTIONS, USER_HUB_PATH } from '../../config/userSettingsSections';

const cards = USER_SETTINGS_SECTIONS.flatMap((s) => s.cards);
const routes = parseAppRoutes(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8'));

describe('USER_SETTINGS_SECTIONS', () => {
  it('declares the Profile, Appearance, Notifications, Terminal, Access Tokens and AI Keys cards', () => {
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
    ]);
  });

  it('declares no card permission but AI Keys (user_settings:* is every role\'s, ai:use is not)', () => {
    expect(cards.filter((c) => c.permission !== undefined).map((c) => [c.path, c.permission, c.feature])).toEqual([
      // The `/api/ai/keys` controller's string; hidden while AI is off.
      ['/settings/ai', 'ai:use', 'ai'],
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
