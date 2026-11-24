// Terminal domain types: key shortcuts, server profiles and terminal
// sessions, plus the `terminal` user-settings namespace.

import type { UserSettingsResponseBase } from '@marinoscar/platform-contract/settings';

// Key Shortcuts

/**
 * Canonical base-key identifiers. Mirrors KEY_SHORTCUT_BASE_KEYS in
 * apps/api/src/terminal/settings/terminal.user-settings.ts — keep in sync.
 */
export const KEY_SHORTCUT_BASE_KEYS = [
  'Escape', 'Tab', 'Enter', 'Backspace', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
] as const;

export type KeyShortcutModifier = 'ctrl' | 'shift' | 'alt' | 'meta';

export interface Keystroke {
  modifiers: KeyShortcutModifier[];
  key: (typeof KEY_SHORTCUT_BASE_KEYS)[number];
}

export interface KeyShortcut {
  id: string;
  label: string;
  keystrokes: Keystroke[];
}

/** When the on-screen key bar shows: `auto` on touch devices only (#80). */
export const TERMINAL_KEY_BAR_MODES = ['auto', 'always', 'never'] as const;
/** The monospace fonts the app bundles; `system` is the platform's own stack. */
export const TERMINAL_FONT_FAMILIES = ['system', 'jetbrains-mono', 'fira-code', 'source-code-pro'] as const;
export const TERMINAL_CURSOR_STYLES = ['block', 'bar', 'underline'] as const;
export const TERMINAL_THEMES = ['follow-app', 'dark', 'light', 'solarized-dark', 'solarized-light'] as const;
export const TERMINAL_BELL_MODES = ['none', 'visual', 'sound'] as const;

export type TerminalKeyBarMode = (typeof TERMINAL_KEY_BAR_MODES)[number];
export type TerminalFontFamily = (typeof TERMINAL_FONT_FAMILIES)[number];
export type TerminalCursorStyle = (typeof TERMINAL_CURSOR_STYLES)[number];
export type TerminalThemeName = (typeof TERMINAL_THEMES)[number];
export type TerminalBellMode = (typeof TERMINAL_BELL_MODES)[number];

/**
 * The `terminal` user-settings namespace (API: `terminal/settings`), as
 * stored: a row written before #80 holds only `showScrollButtons` and the
 * legacy `keyShortcuts`, so every other field may be absent.
 */
export interface TerminalUserSettings {
  showScrollButtons: boolean;
  showKeyBar?: TerminalKeyBarMode;
  fontFamily?: TerminalFontFamily;
  fontSize?: number;
  lineHeight?: number;
  cursorStyle?: TerminalCursorStyle;
  cursorBlink?: boolean;
  scrollback?: number;
  theme?: TerminalThemeName;
  bell?: TerminalBellMode;
  copyOnSelect?: boolean;
  /** LEGACY (before #80): now `shortcuts.keyShortcuts`. Read through the shim only. */
  keyShortcuts?: KeyShortcut[];
}

/** The `shortcuts` user-settings namespace (#80, API: `terminal/settings`). */
export interface ShortcutsUserSettings {
  keyShortcuts: KeyShortcut[];
}

/**
 * `GET /api/user-settings` as the terminal domain reads it: the platform's
 * document plus the `terminal` and `shortcuts` namespaces, each present ONLY
 * when stored (read them through `lib/terminal/settings.ts`).
 */
export interface TerminalUserSettingsDocument extends UserSettingsResponseBase {
  terminal?: TerminalUserSettings;
  shortcuts?: ShortcutsUserSettings;
}

/** The `PATCH /api/user-settings` body the terminal domain sends. */
export interface TerminalUserSettingsUpdate {
  /** The whole namespace (`null` removes it, so the defaults apply). */
  terminal?: Omit<TerminalUserSettings, 'keyShortcuts'> | null;
  shortcuts?: ShortcutsUserSettings | null;
}

// Server Profiles
export type ServerProfileColor = 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';

/** Who owns a shared record: a user or a group (#71). */
export interface SharedOwner {
  kind: 'user' | 'group';
  id: string | null;
  name: string | null;
}

/** What the caller is to a server profile, and what that lets them do (#71). */
export interface ServerProfileAccess {
  /** `owner`, or the role a share or the owning group gives them (`viewer`, `operator`, `editor`). */
  role: string | null;
  via: string | null;
  /** False only for a profile the caller owns outright. */
  shared: boolean;
  /** Whether the caller saved the SSH credentials: only they may change the connection or the secrets. */
  credentialHolder: boolean;
  can: { connect: boolean; test: boolean; write: boolean; share: boolean; delete: boolean };
}

export interface ServerProfile {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key' | 'agent';
  /**
   * Which secrets the credential store holds. Sent to the user who saved them ONLY (a grantee gets
   * none of these three fields), so absent means "not yours to know".
   */
  hasPassword?: boolean;
  hasPrivateKey?: boolean;
  hasPassphrase?: boolean;
  /** The user who created the profile and holds its credentials. */
  userId?: string;
  /** Who owns it (#71). Absent only in a hand-built fixture. */
  owner?: SharedOwner;
  /** What the caller may do with it (#71). Absent only in a hand-built fixture: treated as the owner. */
  access?: ServerProfileAccess;
  /** The trusted host key's `SHA256:` fingerprint, or `null` while no key is trusted (#60). */
  fingerprint: string | null;
  /** The trusted key's algorithm (`ssh-ed25519`, ...), or `null`. */
  hostKeyAlgorithm?: string | null;
  /** When the key was trusted (ISO), or `null`. */
  hostKeyTrustedAt?: string | null;
  /** What the server runs, probed after a successful connect, or `null`. */
  facts?: ServerFacts | null;
  /** When the facts were probed (ISO), or `null`. */
  factsProbedAt?: string | null;
  tags: string[];
  color: ServerProfileColor;
  createdAt: string;
  updatedAt: string;
}

/** The facts the API probes on a server (`apps/api/src/ssh/server-facts.ts`). */
export interface ServerFacts {
  kernel: string;
  os: 'linux' | 'darwin' | 'freebsd' | 'other';
  distroId?: string;
  distroVersion?: string;
  prettyName?: string;
  shell?: string;
  has: string[];
  packageManager?: 'apt' | 'dnf' | 'yum' | 'apk' | 'zypper' | 'brew';
}

/** The two host-key refusals of the SSH layer (#60). */
export type HostKeyErrorCode = 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH';

/** A host key as the server presented it. */
export interface PresentedHostKey {
  fingerprint: string;
  algorithm: string;
}

/**
 * A host-key refusal, from a test connection, the terminal socket or a 409:
 * what the server presented, what the profile trusts (`null` when nothing).
 */
export interface HostKeyRefusal {
  code: HostKeyErrorCode;
  presented: PresentedHostKey;
  expected: string | null;
  serverProfileId: string;
}

/** `POST /server-profiles/:id/host-key/scan`. */
export interface HostKeyScanResult {
  presented: PresentedHostKey;
  trusted: { fingerprint: string; algorithm: string | null; trustedAt: string | null } | null;
  matches: boolean;
}

/** `POST /server-profiles/:id/facts/refresh`. */
export interface ServerFactsRefreshResult {
  facts: ServerFacts | null;
  factsProbedAt: string | null;
}

export interface ServerProfileFormData {
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key' | 'agent';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  tags?: string[];
  color?: ServerProfileColor;
}

export interface ServerProfilesResponse {
  items: ServerProfile[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  /** Set when the host key was refused; no credential was sent (#60). */
  code?: HostKeyErrorCode;
  presented?: PresentedHostKey;
  expected?: string | null;
}

// Terminal Sessions
export type SessionStatus = 'active' | 'detached' | 'terminated';

export interface TerminalSession {
  id: string;
  name: string;
  status: SessionStatus;
  tmuxSessionId: string;
  cols: number;
  rows: number;
  lastActivityAt: string;
  terminatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The session's server profile (the API returns it; `serverProfile` carries no id). */
  serverProfileId?: string;
  serverProfile: {
    /** Not returned by `GET /api/sessions*`; read `serverProfileId`. */
    id?: string;
    name: string;
    hostname: string;
    port: number;
    username: string;
    color: ServerProfileColor;
  };
}

export interface SessionsResponse {
  items: TerminalSession[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSessionData {
  serverProfileId: string;
  name?: string;
}
