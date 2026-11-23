---
name: add-settings-page
description: Add an admin or per-user settings page to the ShellKeep web app as a registry card - the entry in adminSections.tsx or userSettingsSections.tsx, the exact permission string the API controller enforces, reuse of SettingsHub, the route, and the registry tests. Use when adding any new settings screen, admin Console page or per-user preference page (for example terminal or keyboard-shortcut preferences).
---

# Add a settings page

**Applies from #76** (platform shell, destinations and settings registries). Today the settings screens are standalone pages (`apps/web/src/pages/SystemSettingsPage.tsx`, `UserSettingsPage.tsx`, `ServerProfilesPage.tsx`); a new settings screen before #76 should wait or be built so that #76 can turn it into a card without rework. Rule: root `AGENTS.md`, "Settings UI Pattern". Run web checks from `apps/web`.

## Steps

1. Write the page component. Gate writes inside the page (disabled controls), not with a second card permission. The API enforces; the UI only hides.
2. Add ONE card to the registry, appended after existing cards in its group (never inserted between):
   - admin: `ADMIN_SECTIONS` in `apps/web/src/config/adminSections.tsx` *(target)*
   - per-user: `USER_SETTINGS_SECTIONS` in `apps/web/src/config/userSettingsSections.tsx` *(target)*
   A card is a `SettingsCardDef`: `{ title, description, Icon, path?, disabled?, permission?, feature?, alwaysShow? }`. `Icon` is a component, never a rendered element. `feature` (`'ai'`, `'telemetry'`, `'orgs'`) hides the card while that deployment feature is off; the card that switches a feature on carries none (the admin `AI` card).
3. Add the route in `apps/web/src/App.tsx` beside the other `/admin/settings/*` (or `/settings/*`) routes. A route without a registry entry is unacceptable: the hub, the Console rail and the AppBar title resolver would not know it.
4. Add API calls through `apps/web/src/services/api.ts`, wrapped in a hook in `apps/web/src/hooks/`.

## Rules

- A new page is a card, never a tab on an existing settings page. Tabs are only for parallel content inside one destination (the Users and Allowlist page).
- `permission` is the exact string the API controller enforces; read it off the controller (`@Auth(...)` in the target layout, `@Permissions(...)` today). Never invent or approximate it. An admin settings card reuses `system_settings:read`.
- Reuse the packaged `SettingsHub` (`@marinoscar/platform-web/settings/ui`); a new hub is a small binding (`sections`, `hubKey`, `title`, `subtitle`). Never fork or copy it.
- The five breakpoint gates (`ShellLayout` `showRail` and `<main>` `pb`, `ShellBottomNav`, `SettingsHub` and `ShellAppBar` `isCompactWindow`, all at `sm` 600px) move together or not at all. Do not touch them for a normal page. The terminal workspace must keep working at phone width.
- Terminal and keyboard-shortcut preferences are per-user cards (#80); they must not remove `TerminalKeyShortcutsBar`, `TerminalScrollButtons`, `useTouchScroll` or `useKeyboardInset`.
- Never put an AI provider key in the browser or call a provider from it; AI goes through `/api/ai/*`. AI cards declare `feature: 'ai'`.
- Never render an SSH secret; the API never returns one.

## Verify

```bash
cd apps/web && npm run typecheck && npm run test:run
```

Add a registry test beside the card, component and hook tests, and check phone width and desktop width. Flag the card for the docs agent (settings inventory in `docs/ARCHITECTURE.md`).
