# apps/web rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the React app. Scrolling behaviour: [docs/SCROLLING.md](../../docs/SCROLLING.md).

## Layout

- `src/pages/`, `src/components/` (`terminal/`, `server-profiles/`, `home/`, `common/`), `src/hooks/`, `src/services/api.ts`, `src/config/` (the registries), `src/platform/` (the packaged `PlatformHostProvider` binding, #48; the shell themes, `shellTheme.ts`, #76).
- The shell is the platform's (`@marinoscar/platform-web/shell`, since #76): `components/common/Layout.tsx` binds `ShellLayout` (brand, the notification bell, the user menu, the banners) and reads NO breakpoint (`__tests__/config/breakpointGates.test.ts`). Navigation is `config/destinations.ts` (`DESTINATIONS`, `DESTINATION_ROUTES`, `UNOWNED_ROUTES`) bound in `config/shell.ts` (`SHELLKEEP_NAVIGATION`, Console mode under `/admin`). A new route is owned by one destination or listed as unowned. A page that needs the whole main area (the terminal workspace at `/sessions/:id`, `pages/TerminalWorkspacePage.tsx`, #77) calls `useShellMainVariant('full-bleed')`. The workspace keeps its layout in the URL (`?tabs=a,b&split=v:a|b`) plus a per-user localStorage copy of tab ids only; its parts are in `components/terminal/workspace/` (tabs, `SplitLayout`, the session switcher pane and menu, the status bar) and `components/terminal/ai/` (the AI panel, shown only with the `ai` feature and `ai:use`). Phone and wide layout decisions go through `components/terminal/useTerminalLayout.ts` only.
- Settings are the platform's (`@marinoscar/platform-web/settings`, since #48): `/settings` is the packaged `SettingsHub` over `src/config/userSettingsSections.tsx`, with the packaged Profile and Appearance pages and the terminal domain's Terminal page. Read terminal preferences only through `useTerminalSettings` (`src/hooks/`): the API omits the `terminal` namespace until it is stored, and the hook applies the defaults (`src/lib/terminal/settings.ts`).
- Identity is the platform's (`@marinoscar/platform-web/identity`, since #47): `src/identity/` binds `AuthProvider`, the adapters and the branded `LoginPage`; read the user with `useAuth()` and gate on `usePermissions().hasPermission('<the exact API string>')`, never on a role name. The terminal socket re-sends `auth` after each token refresh (`services/terminal-ws.ts`).
- Notifications are the platform's (`@marinoscar/platform-web/notifications`, since #51): `src/platform/notifications.ts` configures the slice, `NotificationProvider` wraps the signed-in shell (`ShellProviders` in `App.tsx`) and the bell is the shell AppBar's `actions`. The service worker is the app's `src/sw.ts` (`injectManifest`, checked by `tsconfig.worker.json`): it must never call the API or cache anything under `/api`, and it imports the push handlers from `/notifications/service-worker`, never the `/headless` barrel.
- `src/config/` holds the registries (`adminSections.tsx`, `userSettingsSections.tsx`, `destinations.ts`, `shell.ts`); most features come from `@marinoscar/platform-web/<slice>` and the app binds them. Fix a packaged page in the platform, not by copying it here.
- Tests: `src/__tests__/` (Vitest + RTL) and beside components. Run `npm run test:run` and `npm run typecheck` in this folder.

## Terminal components that must survive every refactor

These carry the phone experience; the shell and UI epics (#37, #77) rework around them, never delete them. Behaviour changes need tests and a manual phone-width check.

| Piece | Path | Job |
|---|---|---|
| `TerminalView` | `src/components/terminal/TerminalView.tsx` | xterm.js instance, fit, WebSocket I/O, resize, reconnect |
| `TerminalKeyShortcutsBar` | `src/components/terminal/TerminalKeyShortcutsBar.tsx` | Configurable key shortcuts bar (Esc, Tab, Ctrl, arrows) for touch keyboards |
| `TerminalScrollButtons` | `src/components/terminal/TerminalScrollButtons.tsx` | Press-and-hold scroll up/down buttons (synthetic xterm wheel events) |
| `useTouchScroll` | `src/hooks/useTouchScroll.ts` | Turns touch swipes into xterm wheel events |
| `useKeyboardInset` | `src/hooks/useKeyboardInset.ts` | Pixels covered by the on-screen keyboard (VisualViewport) |

## Settings UI Pattern (rules in root AGENTS.md, in force since #76)

1. A new settings page is a card appended to `ADMIN_SECTIONS` or `USER_SETTINGS_SECTIONS`, plus its route. No route without a card.
2. Never add a settings page as a tab of another settings page.
3. A card's `permission` is the exact string the API controller enforces. Gate writes inside the page.
4. Reuse `SettingsHub` from `@marinoscar/platform-web/settings/ui`; never fork it.
5. The five breakpoint gates (`ShellLayout` `showRail` and `<main>` `pb`, `ShellBottomNav`, `SettingsHub` and `ShellAppBar` `isCompactWindow`, all at `sm` 600px) move together or not at all. The terminal workspace must work at phone width with them.

## Frontend conventions

- The UI presents; the API authorizes. Hiding a card or button is not security.
- The access token goes in `Authorization: Bearer`; the only cookie is the HttpOnly `refresh_token`.
- Never call an AI provider from the browser; go through `/api/ai/*`. Terminal output sent to AI is redacted server-side (root AI rule 6).
- Never store or render SSH secrets; the API never returns them.
- Use MUI theming and responsive layouts; write components and hooks with tests.
