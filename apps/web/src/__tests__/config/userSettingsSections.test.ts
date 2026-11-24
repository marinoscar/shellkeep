import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppRoutes } from '@marinoscar/platform-web/settings/testing';
import { dangerZoneLastViolations } from '@marinoscar/platform-web/user-data/headless';
import { USER_SETTINGS_SECTIONS, USER_HUB_PATH } from '../../config/userSettingsSections';

const cards = USER_SETTINGS_SECTIONS.flatMap((s) => s.cards);
const routes = parseAppRoutes(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8'));

describe('USER_SETTINGS_SECTIONS', () => {
  it('declares the Profile, Appearance, Notifications, Getting started, Terminal, Keyboard shortcuts, Access Tokens, AI Keys, Webhooks, Groups and Download your data cards', () => {
    expect(cards.map((c) => [c.title, c.path])).toEqual([
      ['Profile', '/settings/profile'],
      ['Appearance', '/settings/appearance'],
      // #51: appended to Account.
      ['Notifications', '/settings/notifications'],
      // #70: the onboarding slice's Getting started card, appended to Account.
      ['Getting started', '/settings/getting-started'],
      ['Terminal', '/settings/terminal'],
      // #80: appended to Workspace.
      ['Keyboard shortcuts', '/settings/shortcuts'],
      // #76: the identity slice's Security card, appended.
      ['Access Tokens', '/settings/tokens'],
      // #55: appended to Security.
      ['AI Keys', '/settings/ai'],
      // #54: the webhooks slice's Integrations card, appended.
      ['Webhooks', '/settings/webhooks'],
      // #71: the sharing slice's Sharing card, appended.
      ['Groups', '/settings/groups'],
      // #68: the exports slice's card, appended in its own group.
      ['Download your data', '/settings/data-export'],
      // #69: the user-data slice's Danger Zone group, pinned last.
      ['Delete my data', '/settings/danger-zone'],
    ]);
  });

  it('pins the Danger Zone last, ungated: no permission and no feature, so it stays reachable while AI is off (#69)', () => {
    expect(dangerZoneLastViolations(USER_SETTINGS_SECTIONS, '/settings/danger-zone')).toEqual([]);
    const card = USER_SETTINGS_SECTIONS[USER_SETTINGS_SECTIONS.length - 1]!.cards[0]!;
    expect(card).toMatchObject({ title: 'Delete my data', path: '/settings/danger-zone' });
    expect(card.permission).toBeUndefined();
    expect(card.feature).toBeUndefined();
  });

  it('puts Terminal and Keyboard shortcuts in Workspace, with no permission (#80)', () => {
    const workspace = USER_SETTINGS_SECTIONS.find((s) => s.label === 'Workspace');
    expect(workspace?.cards.map((c) => [c.title, c.path, c.permission])).toEqual([
      ['Terminal', '/settings/terminal', undefined],
      ['Keyboard shortcuts', '/settings/shortcuts', undefined],
    ]);
  });

  it('declares no card permission but AI Keys, Webhooks and Groups (user_settings:* is every role\'s)', () => {
    // `ai:use` is the `/api/ai/keys` controller's string, `webhooks:read` the one `/api/webhooks` enforces and
    // `groups:read` the one `/api/groups` enforces (#71).
    expect(cards.filter((c) => c.permission !== undefined).map((c) => [c.path, c.permission, c.feature ?? null])).toEqual([
      ['/settings/ai', 'ai:use', 'ai'],
      ['/settings/webhooks', 'webhooks:read', null],
      ['/settings/groups', 'groups:read', null],
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

  it('has a card for every /settings/* route (a child route `/settings/<card>/:id` belongs to its card)', () => {
    const settingsRoutes = routes
      .filter((r) => r.path.startsWith(`${USER_HUB_PATH}/`))
      .map((r) => r.path.replace(/\/:[^/]+$/, ''));
    expect([...new Set(settingsRoutes)].sort()).toEqual(cards.map((c) => c.path).sort());
    // The group detail page (#71) gates on the same permission as its card.
    expect(routes.find((r) => r.path === '/settings/groups/:id')?.permission).toBe('groups:read');
  });
});
