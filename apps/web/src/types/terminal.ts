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
  fingerprint: string | null;
  tags: string[];
  color: ServerProfileColor;
  createdAt: string;
  updatedAt: string;
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
  serverProfile: {
    id: string;
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
