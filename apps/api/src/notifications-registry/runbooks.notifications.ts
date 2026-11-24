// =============================================================================
// The runbook events (issue #51)
// =============================================================================
//
// `runbooks.run_finished`, `runbooks.run_failed` and `runbooks.approval_requested` (plus the in-app
// `runbooks.dry_run_finished` of #67 and `runbooks.schedule_disabled` of #66),
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
/** A dry run finished (#67): in-app only, so a rehearsal never emails or pushes anyone. */
export const RUNBOOK_DRY_RUN_FINISHED_EVENT = 'runbooks.dry_run_finished';
/** The system switched a schedule off (#66): permission revoked, approval required, runbook archived. In-app only. */
export const RUNBOOK_SCHEDULE_DISABLED_EVENT = 'runbooks.schedule_disabled';

/** What the schedule-disabled notification names: the schedule, its runbook and why; never a parameter or a host. */
export interface RunbookScheduleDisabledData {
  scheduleName: string;
  runbookName: string;
  /** A `disabled_reason` code (`PERMISSION_REVOKED`, `APPROVAL_REQUIRED`, ...). */
  reason: string;
  /** A root-relative link to the runbook's schedules. */
  link: string;
}

const SCHEDULE_DISABLED_COPY: Record<string, string> = {
  PERMISSION_REVOKED: 'you no longer have the permissions it needs to run',
  APPROVAL_REQUIRED: 'its runbook version is destructive and has not been approved',
  RUNBOOK_ARCHIVED: 'its runbook was archived',
  VERSION_MISSING: 'the version it was pinned to no longer exists',
  RUN_REJECTED: 'its run could not be created (check its parameters, secrets and targets)',
};

export const runbookScheduleDisabledBrowserTemplate = (data: RunbookScheduleDisabledData) => ({
  title: `Schedule "${data.scheduleName}" was turned off`,
  body: `Runbook "${data.runbookName}": ${SCHEDULE_DISABLED_COPY[data.reason] ?? 'it can no longer run'}.`,
  link: data.link,
});

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

export const runbookDryRunFinishedBrowserTemplate = (data: RunbookRunNotificationData) => ({
  title: `Dry run of "${data.runbookName}" finished`,
  body: `Version ${data.version}: ${data.targetsSucceeded} of ${data.targetsTotal} targets would run cleanly, ${data.targetsFailed} would fail.`,
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
  {
    event: {
      key: RUNBOOK_DRY_RUN_FINISHED_EVENT,
      label: 'Runbook dry run finished',
      description: 'Sent in the app when a dry run you started finishes. Dry runs never send email or push.',
      channels: ['browser'],
      defaultEnabled: true,
    },
    browserTemplate: runbookDryRunFinishedBrowserTemplate,
  },
  {
    event: {
      key: RUNBOOK_SCHEDULE_DISABLED_EVENT,
      label: 'Runbook schedule turned off',
      description: 'Sent in the app when a runbook schedule you own is switched off because it can no longer run (permission revoked, approval needed).',
      channels: ['browser'],
      defaultEnabled: true,
    },
    browserTemplate: runbookScheduleDisabledBrowserTemplate,
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
