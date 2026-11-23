// The signed-in user, the sign-in providers, users, the allowlist and the
// device flow are the identity slice's types (`@marinoscar/platform-web/identity/headless`:
// `AuthUser`, `AuthProviderInfo`, `UserListItem`, `AllowedEmailEntry`, ...), issue #47.

/**
 * Per-namespace user settings contributed by domain modules. A domain adds its
 * namespace by augmenting this interface (see `types/terminal.ts`), the web
 * counterpart of the API's `registerUserSettingsNamespaces`, so the base
 * `UserSettings` names no domain.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UserSettingsNamespaces {}

export interface UserSettings extends UserSettingsNamespaces {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  updatedAt: string;
  version: number;
}

export interface SystemSettings {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: Record<string, boolean>;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

// Domain types, re-exported so existing `types` imports keep working. New
// domain code imports them from `types/terminal` directly.
export * from './terminal';
