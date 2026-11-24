import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { SchedulesCard } from '../../../features/runbooks/components/SchedulesCard';
import { buildCron, parseCron } from '../../../features/runbooks/lib/cron';
import type { RunbookSchedule } from '../../../features/runbooks/api/types';
import { makeDefinition, RUNBOOK_ID, runbookUser } from './fixtures';

const schedule = (over: Partial<RunbookSchedule> = {}): RunbookSchedule => ({
  id: '33333333-3333-4333-8333-333333333333',
  runbookId: RUNBOOK_ID,
  name: 'Nightly disk check',
  cron: '0 2 * * *',
  timezone: 'Europe/Berlin',
  versionPin: 'latest',
  resolvedVersion: 3,
  params: {},
  secretRefs: {},
  targets: {},
  strategy: null,
  overlap: 'skip',
  enabled: true,
  nextRunAt: '2026-12-01T01:00:00.000Z',
  lastRunId: null,
  lastRunStatus: null,
  lastFiredAt: null,
  runAsUserId: 'u1',
  disabledReason: null,
  destructive: false,
  approval: { state: 'not_required', approvedBy: null, approvedAt: null, approvedVersion: null },
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

function serve(items: RunbookSchedule[]) {
  server.use(http.get(`*/api/runbooks/${RUNBOOK_ID}/schedules`, () => HttpResponse.json({ data: { items, total: items.length, page: 1, pageSize: 50 } })));
}

const renderCard = (props: Partial<React.ComponentProps<typeof SchedulesCard>> = {}) =>
  render(
    <SchedulesCard runbookId={RUNBOOK_ID} runbookName="Patch web tier" definition={makeDefinition()} canWrite canRun canApprove={false} {...props} />,
    { wrapperOptions: { user: runbookUser(['runbooks:read']) } },
  );

describe('SchedulesCard', () => {
  it('lists a schedule with its cron, zone and next run, and turns it off', async () => {
    serve([schedule()]);
    let patched: unknown = null;
    server.use(
      http.patch(`*/api/runbooks/${RUNBOOK_ID}/schedules/*`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ data: schedule({ enabled: false }) });
      }),
    );
    renderCard();
    expect(await screen.findByText('Nightly disk check')).toBeInTheDocument();
    expect(screen.getByText('0 2 * * * · Europe/Berlin')).toBeInTheDocument();
    expect(screen.getByText(/Next run/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Turn off Nightly disk check' }));
    await waitFor(() => expect(patched).toEqual({ enabled: false }));
  });

  it('shows the permission-revoked banner for a schedule the system switched off', async () => {
    serve([schedule({ enabled: false, nextRunAt: null, disabledReason: 'PERMISSION_REVOKED' })]);
    renderCard();
    expect(await screen.findByText(/Turned off: permission revoked/)).toBeInTheDocument();
    expect(screen.getByText('Not scheduled to run')).toBeInTheDocument();
  });

  it('offers Approve on an unapproved destructive schedule, and no way to enable it', async () => {
    serve([schedule({ enabled: false, nextRunAt: null, destructive: true, disabledReason: 'APPROVAL_REQUIRED', approval: { state: 'pending', approvedBy: null, approvedAt: null, approvedVersion: null } })]);
    server.use(http.post(`*/api/runbooks/${RUNBOOK_ID}/schedules/*/approve`, () => HttpResponse.json({ data: schedule() })));
    renderCard({ canApprove: true });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Turn on/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run Nightly disk check now' })).toBeDisabled();
  });

  it('hides the write actions without the permission', async () => {
    serve([schedule()]);
    renderCard({ canWrite: false, canRun: false });
    await screen.findByText('Nightly disk check');
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe('cron presets', () => {
  it('builds and reads back hourly, daily, weekly and custom expressions', () => {
    expect(buildCron({ preset: 'hourly', minute: 15, hour: 0, weekday: 0, custom: '' })).toBe('15 * * * *');
    expect(buildCron({ preset: 'daily', minute: 0, hour: 2, weekday: 0, custom: '' })).toBe('0 2 * * *');
    expect(buildCron({ preset: 'weekly', minute: 30, hour: 4, weekday: 1, custom: '' })).toBe('30 4 * * 1');
    expect(parseCron('15 * * * *')).toMatchObject({ preset: 'hourly', minute: 15 });
    expect(parseCron('0 2 * * *')).toMatchObject({ preset: 'daily', hour: 2 });
    expect(parseCron('30 4 * * 1')).toMatchObject({ preset: 'weekly', weekday: 1 });
    expect(parseCron('*/5 * * * *')).toMatchObject({ preset: 'custom', custom: '*/5 * * * *' });
  });
});
