// =============================================================================
// ShellKeep's email templates (issue #51)
// =============================================================================
//
// The platform's email slice owns the layout, the safe-HTML helpers, the registry and
// the transports (`@marinoscar/platform-api/email`); this folder holds the templates
// of ShellKeep's own events. A template NAME is persisted by delivery rows and the
// preferences matrix: never rename one, add a new name. A duplicate name throws at
// import, so nothing here may share a name with a platform template.
//
//   SHELLKEEP_EMAIL_TEMPLATES          registered by the notification manifest
// =============================================================================

import type { EmailTemplateEntry } from '@marinoscar/platform-api/email';

import { terminalSessionReapedEmail } from './terminal-session-reaped.email';

/** The registrant recorded for these templates in the bootstrap log. */
export const SHELLKEEP_EMAIL_REGISTRANT = 'app';

/** ShellKeep's templates registered with the app, in the order their events list. */
export const SHELLKEEP_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'terminal-session-reaped', render: terminalSessionReapedEmail, registrant: SHELLKEEP_EMAIL_REGISTRANT },
];
