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

/** The `terminal` user-settings namespace (API: `terminal/settings`). */
export interface TerminalUserSettings {
  showScrollButtons: boolean;
  keyShortcuts?: KeyShortcut[];
}

/**
 * `GET /api/user-settings` as the terminal domain reads it: the platform's
 * document plus the `terminal` namespace, present ONLY when stored (apply
 * `resolveTerminalSettings` of `lib/terminal/settings.ts`).
 */
export interface TerminalUserSettingsDocument extends UserSettingsResponseBase {
  terminal?: TerminalUserSettings;
}

/** The `PATCH /api/user-settings` body the terminal domain sends. */
export interface TerminalUserSettingsUpdate {
  /** The whole namespace (`null` removes it, so the defaults apply). */
  terminal?: TerminalUserSettings | null;
}

// Server Profiles
export type ServerProfileColor = 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';

export interface ServerProfile {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key' | 'agent';
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
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
  /** `false`: no terminal output of this server ever reaches an AI feature (#56). Treat absent as `true`. */
  aiOutputSharing: boolean;
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
  aiOutputSharing?: boolean;
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
