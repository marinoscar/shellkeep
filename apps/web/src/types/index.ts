export interface Role {
  name: string;
}

// =============================================================================
// Key Shortcuts
// =============================================================================

/**
 * Canonical base-key identifiers. Mirrors KEY_SHORTCUT_BASE_KEYS in
 * apps/api/src/common/schemas/settings.schema.ts — keep in sync.
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

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: Role[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  terminal?: {
    showScrollButtons: boolean;
    keyShortcuts?: KeyShortcut[];
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

export interface AuthProvider {
  name: string;
  authUrl: string;
}

export interface AllowedEmailEntry {
  id: string;
  email: string;
  addedBy: { id: string; email: string } | null;
  addedAt: string;
  claimedBy: { id: string; email: string } | null;
  claimedAt: string | null;
  notes: string | null;
}

export interface AllowlistResponse {
  items: AllowedEmailEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  profileImageUrl: string | null;
  providerProfileImageUrl?: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeviceActivationInfo {
  userCode: string;
  clientInfo: {
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  };
  expiresAt: string;
}

export interface DeviceAuthorizationResponse {
  success: boolean;
  message: string;
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
