import '../../shellkeep.manifest';
import '../../app-registrations/registrations';

import { findWebhookEvent } from '@marinoscar/platform-api/webhooks';

import { RUNBOOK_WEBHOOK_EVENTS, runbookApprovalRequestedSchema, runbookRunCompletedSchema } from './runbooks.webhooks';

const SECRET_SHAPED = /secret|password|passphrase|private|token|credential|output|command|stdin|stdout|hostname|username|address|param/i;
const shapeKeys = (schema: unknown): string[] => Object.keys((schema as { shape: Record<string, unknown> }).shape);

describe('runbook webhook events', () => {
  it.each([
    [RUNBOOK_WEBHOOK_EVENTS.RUN_COMPLETED, 'runbook.run.completed'],
    [RUNBOOK_WEBHOOK_EVENTS.APPROVAL_REQUESTED, 'runbook.approval.requested'],
  ])('registers %s for the organization with runbooks:read', (key, expected) => {
    expect(key).toBe(expected); // permanent
    const event = findWebhookEvent(key);
    expect(event).toMatchObject({ audience: 'org', permission: 'runbooks:read', source: 'runbooks', group: 'Runbooks' });
    expect(event!.payloadSchema.safeParse(event!.example).success).toBe(true);
  });

  it('carries metadata only and is strict', () => {
    for (const schema of [runbookRunCompletedSchema, runbookApprovalRequestedSchema]) {
      for (const field of shapeKeys(schema)) expect(field).not.toMatch(SECRET_SHAPED);
    }
    const example = findWebhookEvent(RUNBOOK_WEBHOOK_EVENTS.RUN_COMPLETED)!.example as object;
    expect(runbookRunCompletedSchema.safeParse({ ...example, output: 'x' }).success).toBe(false);
    expect(runbookRunCompletedSchema.safeParse({ ...example, status: 'running' }).success).toBe(false);
    const approval = findWebhookEvent(RUNBOOK_WEBHOOK_EVENTS.APPROVAL_REQUESTED)!.example as object;
    expect(runbookApprovalRequestedSchema.safeParse({ ...approval, command: 'rm -rf /' }).success).toBe(false);
  });
});
