// =============================================================================
// The app's composition root for static registries
// =============================================================================
//
// IMPORT THIS FIRST. `main.ts`, `app.module.ts` and `test/setup.ts` import it
// before anything that reads the registries, because the user-settings DTOs
// and `DEFAULT_USER_SETTINGS` are COMPOSED FROM THEM AT IMPORT TIME. The
// composers throw on an empty registry, so a mis-wired entry point fails on
// start instead of silently stripping a namespace from every PATCH.
//
// This is the one file (with `app.module.ts`, `main.ts` and
// `app-registrations/`) that knows both base and domain: base modules import
// no domain code (`test/architecture/base-domain-boundary.spec.ts`).
//
// ORDER IS THE STORED KEY ORDER: append, never insert.
//   user settings: terminal
//
// Registration is once per module registry (once per process, once per Jest
// test file): registering a namespace twice is a `DUPLICATE_ID` error.
// =============================================================================

import { registerUserSettingsNamespaces } from './settings/registry/user-settings-namespaces';
import { TERMINAL_USER_SETTINGS } from './terminal/settings/terminal.user-settings';
import './app-registrations/permissions';

registerUserSettingsNamespaces([TERMINAL_USER_SETTINGS]);
