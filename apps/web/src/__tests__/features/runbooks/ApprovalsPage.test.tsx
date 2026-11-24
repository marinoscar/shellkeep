import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { axe } from 'vitest-axe';
import { server } from '../../mocks/server';
import { render, mockUser } from '../../utils/test-utils';
import ApprovalsPage from '../../../pages/runbooks/ApprovalsPage';
import { SELF_APPROVAL_REASON } from '../../../features/runbooks/components/ApprovalCard';
import { makeApproval, runbookUser } from './fixtures';

function serve(items = [makeApproval()], allowSelfApproval = false) {
  const decisions: unknown[] = [];
  server.use(
    http.get('*/api/runbook-approvals', ({ request }) => {
      if (new URL(request.url).searchParams.get('count') === 'true') return HttpResponse.json({ data: { count: items.length } });
      return HttpResponse.json({ data: { items, total: items.length, page: 1, pageSize: 100, allowSelfApproval } });
    }),
    http.post('*/api/runbook-approvals/:id/decision', async ({ request }) => {
      decisions.push(await request.json());
      return HttpResponse.json({ data: { id: 'x', status: 'approved' } });
    }),
  );
  return decisions;
}

describe('ApprovalsPage', () => {
  it('shows the kind, the run, the redacted message, the requester and the expiry', async () => {
    serve([makeApproval({ targetName: 'server-007', scope: 'target' })]);
    render(<ApprovalsPage />, { wrapperOptions: { user: runbookUser(['runbooks:read', 'runbooks:approve']) } });
    const card = await screen.findByRole('article', { name: /Patch web tier v3 · Confirm rollout/ });
    expect(within(card).getByText('Approval gate')).toBeInTheDocument();
    expect(within(card).getByText('Check the canary before continuing').tagName).toBe('PRE');
    expect(within(card).getByText(/Server server-007/)).toBeInTheDocument();
    expect(within(card).getByText(/Requested by Person B/)).toBeInTheDocument();
    expect(within(card).getByText(/Expires in 2h 59m|Expires in 3h 00m/)).toBeInTheDocument();
  });

  it('hides Approve and Reject without runbooks:approve', async () => {
    serve();
    render(<ApprovalsPage />, { wrapperOptions: { user: runbookUser(['runbooks:read']) } });
    await screen.findByRole('article');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('disables self-approval with the reason, unless the organization allows it', async () => {
    serve([makeApproval({ initiatedBy: mockUser.id })], false);
    const { unmount } = render(<ApprovalsPage />, { wrapperOptions: { user: runbookUser(['runbooks:read', 'runbooks:approve']) } });
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(screen.getAllByLabelText(SELF_APPROVAL_REASON)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    unmount();

    serve([makeApproval({ initiatedBy: mockUser.id })], true);
    render(<ApprovalsPage />, { wrapperOptions: { user: runbookUser(['runbooks:read', 'runbooks:approve']) } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it('sends a decision with the comment', async () => {
    const decisions = serve();
    render(<ApprovalsPage />, { wrapperOptions: { user: runbookUser(['runbooks:read', 'runbooks:approve']) } });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Comment (optional)' }), 'Looks fine');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(decisions).toEqual([{ decision: 'reject', comment: 'Looks fine' }]));
  });

  it('has no axe violations', async () => {
    serve();
    const { container } = render(<ApprovalsPage />, { wrapperOptions: { user: runbookUser(['runbooks:read', 'runbooks:approve']) } });
    await screen.findByRole('article');
    expect((await axe(container)).violations).toEqual([]);
  });
});
