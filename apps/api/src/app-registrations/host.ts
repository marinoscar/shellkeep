// =============================================================================
// The app's host registrations (issue #46)
// =============================================================================
//
// Import-time registrations for the host slice: static registries that freeze
// when the application boots, so they cannot be filled from a provider. Imported
// by `shellkeep.manifest.ts`.
//
//   registerAboutContributor   the `terminal` section of GET /api/admin/about
//
// No maintenance bypass, health indicator or deployment mode is registered: the
// terminal WebSocket applies the window itself (`terminal.gateway.ts`).
// =============================================================================

import { registerTerminalAboutContributor } from '../terminal/about/terminal.about-contributor';

registerTerminalAboutContributor();
