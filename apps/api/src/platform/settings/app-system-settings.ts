// =============================================================================
// ShellKeep's `ui` and `features` system settings namespaces (issue #48)
// =============================================================================
//
// The two keys ShellKeep has always stored in the `global` row of
// `system_settings`. The platform has no namespace for either, so they are the
// app's own (not an extension of a platform namespace). Stored shape unchanged:
//
//   ui.allowUserThemeOverride   boolean, default true
//   features                    free-form feature flags, name -> boolean, default {}
//
// PATCH keeps the old semantics: `ui` merges per field, `features` merges per flag.
// =============================================================================

import { z } from 'zod';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

export interface UiSystemSettings {
  allowUserThemeOverride: boolean;
}

export type FeaturesSystemSettings = Record<string, boolean>;

const uiSchema = z.object({ allowUserThemeOverride: z.boolean() });
const uiPatchSchema = z.object({ allowUserThemeOverride: z.boolean().optional() });

// A namespace's stored schema must be a z.object: a catchall object is the free-form flag map.
const featuresSchema = z.object({}).catchall(z.boolean());

export const UI_SYSTEM_SETTINGS: SystemSettingsNamespace<'ui', UiSystemSettings, Partial<UiSystemSettings>> = {
  key: 'ui',
  description: 'Application-wide UI policy: whether users may override the theme.',
  storedSchema: uiSchema,
  patchSchema: uiPatchSchema,
  putSchema: uiSchema,
  wirePatchSchema: uiPatchSchema,
  responseSchema: uiSchema,
  defaults: { allowUserThemeOverride: true },
  requiredOnPut: false,
  merge: (current, patch) => ({
    allowUserThemeOverride: patch?.allowUserThemeOverride ?? current.allowUserThemeOverride,
  }),
};

export const FEATURES_SYSTEM_SETTINGS: SystemSettingsNamespace<
  'features',
  FeaturesSystemSettings,
  FeaturesSystemSettings
> = {
  key: 'features',
  description: 'Feature flags: flag name to enabled.',
  storedSchema: featuresSchema,
  patchSchema: featuresSchema,
  putSchema: featuresSchema,
  wirePatchSchema: featuresSchema,
  responseSchema: featuresSchema,
  defaults: {},
  requiredOnPut: false,
  // The generic read keeps only the keys of the schema's shape, which is empty here:
  // read the flag map itself, keeping every boolean entry.
  read: (stored, helpers) =>
    Object.fromEntries(
      Object.entries(helpers.asPlainObject(stored) ?? {}).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    ),
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
};

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    ui: UiSystemSettings;
    features: FeaturesSystemSettings;
  }

  interface SystemSettingsNamespaceDeclarations {
    ui: typeof UI_SYSTEM_SETTINGS;
    features: typeof FEATURES_SYSTEM_SETTINGS;
  }
}
