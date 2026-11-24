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
//   RUNBOOK_EMAIL_TEMPLATES            the three runbook templates, registered only by
//                                      `registerRunbookNotifications()` (#61)
//   SHARING_EMAIL_TEMPLATES            `group-invitation` and `shared-with-you` (#71): the words are the
//                                      sharing slice's, the layout and escaping are the email slice's
// =============================================================================

import type { EmailTemplate, EmailTemplateEntry } from '@marinoscar/platform-api/email';

import { groupInvitationEmail, type GroupInvitationEmailData } from './group-invitation.email';
import { sharedWithYouEmail, type SharedWithYouEmailData } from './shared-with-you.email';

import {
  runbookApprovalRequestedEmail,
  runbookRunFailedEmail,
  runbookRunFinishedEmail,
} from './runbook-run.email';
import { terminalSessionReapedEmail } from './terminal-session-reaped.email';

/** The registrant recorded for these templates in the bootstrap log. */
export const SHELLKEEP_EMAIL_REGISTRANT = 'app';

/** ShellKeep's templates registered with the app, in the order their events list. */
export const SHELLKEEP_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'terminal-session-reaped', render: terminalSessionReapedEmail, registrant: SHELLKEEP_EMAIL_REGISTRANT },
];

/** The runbook templates: registered with their events by `registerRunbookNotifications()`. */
export const RUNBOOK_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'runbook-run-finished', render: runbookRunFinishedEmail, registrant: SHELLKEEP_EMAIL_REGISTRANT },
  { name: 'runbook-run-failed', render: runbookRunFailedEmail, registrant: SHELLKEEP_EMAIL_REGISTRANT },
  { name: 'runbook-approval-requested', render: runbookApprovalRequestedEmail, registrant: SHELLKEEP_EMAIL_REGISTRANT },
];

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'group-invitation': GroupInvitationEmailData;
    'shared-with-you': SharedWithYouEmailData;
  }
}

/** The sharing slice's two templates (#71), registered with their events by the notification manifest. */
export const SHARING_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'group-invitation', render: groupInvitationEmail as EmailTemplate<never>, registrant: 'sharing' },
  { name: 'shared-with-you', render: sharedWithYouEmail as EmailTemplate<never>, registrant: 'sharing' },
];

export { groupInvitationEmail, sharedWithYouEmail };
export type { GroupInvitationEmailData, SharedWithYouEmailData };
