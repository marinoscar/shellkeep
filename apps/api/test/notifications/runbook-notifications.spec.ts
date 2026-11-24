// =============================================================================
// The runbook notification events (issue #51)
// =============================================================================
//
// Defined and tested here so keys and copy are reviewed once; Fleet Runbooks (#61)
// calls `registerRunbookNotifications()` when it mounts. Until then the preferences
// matrix must not list them. The "not registered" case runs FIRST in this file: the
// registries are process singletons per Jest module registry, so this file's own
// registration cannot leak into another spec.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { emailTemplateRegistry, findEmailTemplate, renderEmailTemplate } from '@marinoscar/platform-api/email';
import {
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  findEvent,
  listNotificationEvents,
  notificationEventRegistry,
} from '@marinoscar/platform-api/notifications';

import {
  RUNBOOK_APPROVAL_REQUESTED_EVENT,
  RUNBOOK_NOTIFICATIONS,
  RUNBOOK_RUN_FAILED_EVENT,
  RUNBOOK_RUN_FINISHED_EVENT,
  registerRunbookNotifications,
  runbookApprovalRequestedBrowserTemplate,
  runbookRunFailedBrowserTemplate,
  runbookRunFinishedBrowserTemplate,
} from '../../src/notifications-registry/runbooks.notifications';

const KEYS = [RUNBOOK_RUN_FINISHED_EVENT, RUNBOOK_RUN_FAILED_EVENT, RUNBOOK_APPROVAL_REQUESTED_EVENT];
const TEMPLATES = ['runbook-run-finished', 'runbook-run-failed', 'runbook-approval-requested'];

const run = {
  runbookName: 'Rotate <i>logs</i>',
  version: 3,
  targetsTotal: 4,
  targetsSucceeded: 3,
  targetsFailed: 1,
  runLink: '/runbooks/runs/run-1',
};
const approval = {
  runbookName: 'Patch hosts',
  version: 2,
  stepName: 'Restart service',
  targetsTotal: 4,
  runLink: '/runbooks/runs/run-1',
  approvalLink: '/runbooks/runs/run-1/approve',
};

describe('runbook notifications', () => {
  it('are NOT registered until registerRunbookNotifications() runs', () => {
    for (const key of KEYS) {
      expect(findEvent(key)).toBeUndefined();
      expect(notificationEventRegistry.has(key)).toBe(false);
      expect(listNotificationEvents().map((event) => event.key)).not.toContain(key);
    }
    for (const name of TEMPLATES) expect(emailTemplateRegistry.has(name)).toBe(false);
  });

  it('declare the three permanent keys with in-app, email and push', () => {
    expect(RUNBOOK_NOTIFICATIONS.map((entry) => entry.event.key)).toEqual(KEYS);
    for (const entry of RUNBOOK_NOTIFICATIONS) {
      expect(entry.event.channels).toEqual(['browser', 'email', 'push']);
      expect(entry.event.defaultEnabled).toBe(true);
      expect(entry.emailTemplate).toBeDefined();
      expect(entry.browserTemplate).toBeDefined();
    }
  });

  it('register once, with their templates, and a second call is a no-op', () => {
    registerRunbookNotifications();
    registerRunbookNotifications();

    for (const key of KEYS) expect(findEvent(key)).toBeDefined();
    for (const name of TEMPLATES) expect(findEmailTemplate(name)).toBeDefined();
    expect(eventEmailTemplateRegistry.get(RUNBOOK_RUN_FAILED_EVENT)?.template).toBe('runbook-run-failed');
    expect(eventBrowserTemplateRegistry.get(RUNBOOK_APPROVAL_REQUESTED_EVENT)).toBeDefined();
  });

  it('render the finished and failed emails from placeholders only, escaped, with a run link', () => {
    for (const name of ['runbook-run-finished', 'runbook-run-failed'] as const) {
      const email = renderEmailTemplate(name, run);
      expect(email.subject).toContain('Rotate <i>logs</i>');
      expect(email.html).toContain('Rotate &lt;i&gt;logs&lt;/i&gt;');
      expect(email.html).not.toContain('<i>logs</i>');
      expect(email.html).toContain('/runbooks/runs/run-1');
      expect(email.text).toContain('3 of 4 targets succeeded, 1 failed');
    }
  });

  it('render the approval email with the step and the approver link', () => {
    const email = renderEmailTemplate('runbook-approval-requested', approval);
    expect(email.subject).toContain('Restart service');
    expect(email.html).toContain('/runbooks/runs/run-1/approve');
    expect(email.text).toContain('Review and approve');
  });

  it('never turns an absolute link into a button', () => {
    const email = renderEmailTemplate('runbook-run-finished', { ...run, runLink: 'https://evil.example.test/x' });
    expect(email.html).not.toContain('evil.example.test');
    expect(email.text).not.toContain('evil.example.test');
  });

  it('render the bell and push text with root-relative links', () => {
    expect(runbookRunFinishedBrowserTemplate(run)).toEqual({
      title: 'Runbook "Rotate <i>logs</i>" finished',
      body: 'Version 3: 3 of 4 targets succeeded, 1 failed.',
      link: '/runbooks/runs/run-1',
    });
    expect(runbookRunFailedBrowserTemplate(run).title).toBe('Runbook "Rotate <i>logs</i>" failed');
    const needed = runbookApprovalRequestedBrowserTemplate(approval);
    expect(needed.link).toBe('/runbooks/runs/run-1/approve');
    expect(needed.body).toContain('4 targets');
  });

  it('carry no command output, credential or host field', () => {
    for (const email of [renderEmailTemplate('runbook-run-failed', run), renderEmailTemplate('runbook-approval-requested', approval)]) {
      expect(email.html + email.text).not.toMatch(/password|passphrase|private key|stdout|stderr/i);
    }
    expect(Object.keys(run).sort()).toEqual(
      ['runLink', 'runbookName', 'targetsFailed', 'targetsSucceeded', 'targetsTotal', 'version'],
    );
  });
});
