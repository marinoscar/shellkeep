import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { axe } from 'vitest-axe';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import RunbooksPage from '../../../pages/runbooks/RunbooksPage';
import { makeListItem, runbookUser } from './fixtures';

function serve(items = [makeListItem()], pending = 2) {
  const seen: URL[] = [];
  server.use(
    http.get('*/api/runbooks', ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json({ data: { items, total: items.length, page: 1, pageSize: 25 } });
    }),
    http.get('*/api/runbook-approvals', () => HttpResponse.json({ data: { count: pending } })),
  );
  return seen;
}

describe('RunbooksPage', () => {
  it('lists runbooks with step kinds, version, last run and owner', async () => {
    serve();
    render(<RunbooksPage />, { wrapperOptions: { route: '/runbooks', user: runbookUser(['runbooks:read']) } });
    expect(await screen.findByRole('link', { name: 'Patch web tier' })).toHaveAttribute('href', expect.stringContaining('/runbooks/'));
    expect(screen.getByRole('img', { name: /2 steps: Command, Package update/ })).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(await screen.findByRole('link', { name: 'Approvals, 2 pending' })).toBeInTheDocument();
  });

  it('hides Create without runbooks:write', async () => {
    serve();
    render(<RunbooksPage />, { wrapperOptions: { route: '/runbooks', user: runbookUser(['runbooks:read']) } });
    await screen.findByRole('link', { name: 'Patch web tier' });
    expect(screen.queryByRole('link', { name: /Create runbook/ })).not.toBeInTheDocument();
  });

  it('shows Create with runbooks:write and an empty state', async () => {
    serve([], 0);
    render(<RunbooksPage />, { wrapperOptions: { route: '/runbooks', user: runbookUser(['runbooks:read', 'runbooks:write']) } });
    expect(await screen.findByText('No runbooks yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Create runbook/ }).length).toBeGreaterThan(0);
  });

  it('sends the Shared with me filter from the URL', async () => {
    const seen = serve();
    render(<RunbooksPage />, { wrapperOptions: { route: '/runbooks?filter=shared', user: runbookUser(['runbooks:read']) } });
    await screen.findByRole('link', { name: 'Patch web tier' });
    expect(seen.at(-1)?.searchParams.get('filter')).toBe('shared');
    expect(screen.getByRole('button', { name: 'Shared with me' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no axe violations', async () => {
    serve();
    const { container } = render(<RunbooksPage />, { wrapperOptions: { route: '/runbooks', user: runbookUser(['runbooks:read']) } });
    await screen.findByRole('link', { name: 'Patch web tier' });
    await waitFor(() => expect(screen.getByRole('link', { name: /Approvals/ })).toBeInTheDocument());
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
