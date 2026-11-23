// The signed-in user, the sign-in providers, users, the allowlist and the
// device flow are the identity slice's types (`@marinoscar/platform-web/identity/headless`:
// `AuthUser`, `AuthProviderInfo`, `UserListItem`, `AllowedEmailEntry`, ...), issue #47.

// User and system settings are the settings slice's types
// (`@marinoscar/platform-contract/settings`: `UserSettingsResponseBase`,
// `SystemSettingsResponseBase`), issue #48; the terminal namespace is
// `TerminalUserSettingsDocument` of `types/terminal.ts`.

// Domain types, re-exported so existing `types` imports keep working. New
// domain code imports them from `types/terminal` directly.
export * from './terminal';
