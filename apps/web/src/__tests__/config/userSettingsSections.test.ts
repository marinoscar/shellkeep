import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppRoutes } from '@marinoscar/platform-web/settings/testing';
import { USER_SETTINGS_SECTIONS, USER_HUB_PATH } from '../../config/userSettingsSections';

const cards = USER_SETTINGS_SECTIONS.flatMap((s) => s.cards);
const routes = parseAppRoutes(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8'));

describe('USER_SETTINGS_SECTIONS', () => {
  it('declares the Profile, Appearance and Terminal cards', () => {
    expect(cards.map((c) => [c.title, c.path])).toEqual([
      ['Profile', '/settings/profile'],
      ['Appearance', '/settings/appearance'],
      ['Terminal', '/settings/terminal'],
    ]);
  });

  it('declares no card permission (user_settings:* is every role\'s)', () => {
    expect(cards.filter((c) => c.permission !== undefined)).toEqual([]);
  });

  it('has an ungated route in App.tsx for the hub and every card', () => {
    for (const path of [USER_HUB_PATH, ...cards.map((c) => c.path)]) {
      const route = routes.find((r) => r.path === path);
      expect(route, path).toBeDefined();
      expect(route?.permission ?? null, path).toBeNull();
    }
  });

  it('has a card for every /settings/* route', () => {
    const settingsRoutes = routes.filter((r) => r.path.startsWith(`${USER_HUB_PATH}/`)).map((r) => r.path);
    expect(settingsRoutes.sort()).toEqual(cards.map((c) => c.path).sort());
  });
});
