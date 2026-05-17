import { z } from 'zod';

// =============================================================================
// Key Shortcut Schemas
// =============================================================================

// Allowlist of base key identifiers users can pick from.
// Keep this in one place; the frontend will mirror it.
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

export const keystrokeSchema = z.object({
  modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).max(4).default([]),
  key: z.enum(KEY_SHORTCUT_BASE_KEYS),
});

export const keyShortcutSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(40),
  keystrokes: z.array(keystrokeSchema).min(1).max(3),
});

// =============================================================================
// User Settings Schema
// =============================================================================

export const userSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: z.object({
    displayName: z.string().max(100).optional(),
    useProviderImage: z.boolean(),
    customImageUrl: z.string().url().nullable().optional(),
  }),
  terminal: z
    .object({
      showScrollButtons: z.boolean(),
      keyShortcuts: z.array(keyShortcutSchema).max(50).optional(),
    })
    .optional(),
});

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

// Partial schema for PATCH operations
export const userSettingsPatchSchema = userSettingsSchema.deepPartial();

// =============================================================================
// System Settings Schema
// =============================================================================

export const systemSettingsSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  features: z.record(z.string(), z.boolean()),
});

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

// Partial schema for PATCH operations
export const systemSettingsPatchSchema = systemSettingsSchema.deepPartial();
