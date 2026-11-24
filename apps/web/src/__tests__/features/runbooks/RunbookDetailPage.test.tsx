import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import RunbookDetailPage from '../../../pages/runbooks/RunbookDetailPage';
import RunsPage from '../../../pages/runbooks/RunsPage';
import { makeDetail, RUNBOOK_ID, RUN_ID, runbookUser } from './fixtures';

vi.mock('@marinoscar/platform-web/sharing/ui', () => ({
  ShareDialog: ({ open, resource, resourceTitle, roles }: { open: boolean; resource: { type: string; id: string }; resourceTitle: string; roles: { value: string }[] }) =>
    open ? (
      <div role="dialog" aria-label={`Share ${resourceTitle}`} data-type={resource.type} data-id={resource.id} data-roles={roles.map((r) => r.value).join(',')} />
    ) : null,
}));

function serveDetail(detail = makeDetail()) {
  server.use(
    http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: detail })),
    http.get('*/api/runbook-runs', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 5 } })),
  );
}

function renderDetail(permissions: string[]) {
  return render(
    <Routes>
      <Route path="/runbooks/:id" element={<RunbookDetailPage />} />
    </Routes>,
    { wrapperOptions: { route: `/runbooks/${RUNBOOK_ID}`, user: runbookUser(permissions) } },
  );
}

describe('RunbookDetailPage', () => {
  it('opens the share dialog with the runbook roles for its owner', async () => {
    serveDetail();
    renderDetail(['runbooks:read', 'sharing:write']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Patch web tier' })).toBeInTheDocument();
    expect(screen.getByLabelText('Owner: you')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share Patch web tier' });
    expect(dialog).toHaveAttribute('data-type', 'runbook');
    expect(dialog).toHaveAttribute('data-id', RUNBOOK_ID);
    expect(dialog).toHaveAttribute('data-roles', 'viewer,runner,editor');
  });

  it('hides Share, Run and Edit when the record or the role does not allow them', async () => {
    serveDetail(
      makeDetail({
        owner: { kind: 'user', id: 'other', name: 'Person C' },
        access: { role: 'viewer', via: 'grant', shared: true, can: { run: false, write: false, share: false } },
      }),
    );
    renderDetail(['runbooks:read', 'runbooks:run', 'runbooks:write', 'sharing:write']);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByLabelText(/Owner: Person C, shared with you/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

describe('RunsPage', () => {
  it('passes the Home links\' filters to the API', async () => {
    const seen: URL[] = [];
    server.use(
      http.get('*/api/runbook-runs', ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json({
          data: {
            items: [{ id: RUN_ID, runbookId: RUNBOOK_ID, runbookName: 'Patch web tier', version: 3, status: 'failed', trigger: 'manual', initiatedBy: null, createdAt: '2026-01-01T00:00:00.000Z', startedAt: null, finishedAt: null, targets: { total: 4, succeeded: 3, failed: 1, running: 0 } }],
            total: 1,
            page: 1,
            pageSize: 25,
          },
        });
      }),
      http.get('*/api/runbooks', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 100 } })),
    );
    render(<RunsPage />, { wrapperOptions: { route: '/runs?status=failed&since=24h', user: runbookUser(['runbooks:read']) } });
    expect(await screen.findByRole('link', { name: /Patch web tier/ })).toHaveAttribute('href', `/runs/${RUN_ID}`);
    expect(seen.at(-1)!.searchParams.get('status')).toBe('failed');
    expect(seen.at(-1)!.searchParams.get('since')).toBe('24h');
    expect(screen.getByLabelText('3 succeeded, 1 failed, 4 total')).toBeInTheDocument();
  });
});
