// =============================================================================
// The runbook events (issue #51)
// =============================================================================
//
// `runbooks.run_finished`, `runbooks.run_failed` and `runbooks.approval_requested`,
// defined and tested here so their keys, channels and copy are reviewed once. Fleet
// Runbooks (#61) calls `registerRunbookNotifications()` when it mounts its module and
// then `NotificationsService.notify` after the triggering write commits. NOT registered
// by default: the preferences matrix must not list events that cannot fire yet.
//
// Call it before the application bootstraps (the registries freeze then), exactly
// once; a second call is a no-op. KEYS, CHANNEL IDS AND TEMPLATE NAMES ARE PERSISTED.
//
// NEVER IN A PAYLOAD: command output, script text, a credential or a host. A run is
// named by its runbook, version and target counts; links are root-relative paths.
// =============================================================================

import {
  registerEmailTemplates,
  type EmailTemplateEntry,
} from '@marinoscar/platform-api/email';
import {
  registerNotifications,
  type NotificationRegistration,
} from '@marinoscar/platform-api/notifications';

import { RUNBOOK_EMAIL_TEMPLATES } from '../email-templates';
import type {
  RunbookApprovalRequestedData,
  RunbookRunNotificationData,
} from '../email-templates/runbook-run.email';

export const RUNBOOK_RUN_FINISHED_EVENT = 'runbooks.run_finished';
export const RUNBOOK_RUN_FAILED_EVENT = 'runbooks.run_failed';
export const RUNBOOK_APPROVAL_REQUESTED_EVENT = 'runbooks.approval_requested';

const countsBody = (data: RunbookRunNotificationData): string =>
  `${data.targetsSucceeded} of ${data.targetsTotal} targets succeeded, ${data.targetsFailed} failed.`;

export const runbookRunFinishedBrowserTemplate = (data: RunbookRunNotificationData) => ({
  title: `Runbook "${data.runbookName}" finished`,
  body: `Version ${data.version}: ${countsBody(data)}`,
  link: data.runLink,
});

export const runbookRunFailedBrowserTemplate = (data: RunbookRunNotificationData) => ({
  title: `Runbook "${data.runbookName}" failed`,
  body: `Version ${data.version}: ${countsBody(data)}`,
  link: data.runLink,
});

export const runbookApprovalRequestedBrowserTemplate = (data: RunbookApprovalRequestedData) => ({
  title: `Approval needed: "${data.stepName}"`,
  body: `Runbook "${data.runbookName}" (version ${data.version}) is waiting for approval on ${data.targetsTotal} targets.`,
  link: data.approvalLink,
});

/** The three runbook events. Exported for tests; register them through {@link registerRunbookNotifications}. */
export const RUNBOOK_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: RUNBOOK_RUN_FINISHED_EVENT,
      label: 'Runbook run finished',
      description: 'Sent when a runbook run you started finishes on every target.',
      channels: ['browser', 'email', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: 'runbook-run-finished',
    browserTemplate: runbookRunFinishedBrowserTemplate,
  },
  {
    event: {
      key: RUNBOOK_RUN_FAILED_EVENT,
      label: 'Runbook run failed',
      description: 'Sent when a runbook run you started ends with failures on one or more targets.',
      channels: ['browser', 'email', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: 'runbook-run-failed',
    browserTemplate: runbookRunFailedBrowserTemplate,
  },
  {
    event: {
      key: RUNBOOK_APPROVAL_REQUESTED_EVENT,
      label: 'Runbook approval needed',
      description: 'Sent to the people who can approve a runbook step that is waiting for approval.',
      channels: ['browser', 'email', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: 'runbook-approval-requested',
    browserTemplate: runbookApprovalRequestedBrowserTemplate,
  },
];

let registered = false;

/** Registers the runbook email templates and events. Idempotent per process; call before bootstrap. */
export function registerRunbookNotifications(): void {
  if (registered) return;
  registered = true;
  registerEmailTemplates(RUNBOOK_EMAIL_TEMPLATES as readonly EmailTemplateEntry[]);
  registerNotifications(RUNBOOK_NOTIFICATIONS);
}
