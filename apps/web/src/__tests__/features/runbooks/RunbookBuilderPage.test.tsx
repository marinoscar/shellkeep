import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { axe } from 'vitest-axe';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import RunbookBuilderPage from '../../../pages/runbooks/RunbookBuilderPage';
import { makeDefinition, makeDetail, RUNBOOK_ID, runbookUser } from './fixtures';

const user = runbookUser(['runbooks:read', 'runbooks:write']);

function renderEdit() {
  server.use(http.get('*/api/server-profiles', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 100 } })));
  return render(
    <Routes>
      <Route path="/runbooks/:id/edit" element={<RunbookBuilderPage />} />
      <Route path="/runbooks/:id" element={<div>detail page</div>} />
    </Routes>,
    { wrapperOptions: { route: `/runbooks/${RUNBOOK_ID}/edit`, user } },
  );
}

describe('RunbookBuilderPage', () => {
  it('maps validation issue paths onto the step fields', async () => {
    server.use(
      http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail() })),
      http.post('*/api/runbooks/validate', () =>
        HttpResponse.json(
          {
            code: 'RUNBOOK_DEFINITION_INVALID',
            message: 'The definition is invalid',
            details: { issues: [{ path: ['steps', 0, 'command'], code: 'too_small', message: 'A command is required' }] },
          },
          { status: 422 },
        ),
      ),
    );
    renderEdit();
    const command = await screen.findByRole('textbox', { name: 'Command' });
    await userEvent.clear(command);
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByText('A command is required')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Command' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/1 problem\(s\)/)).toBeInTheDocument();
  });

  it('shows the 412 conflict and Overwrite re-fetches, then saves the local edits on the newest version', async () => {
    let version = 3;
    const puts: { ifMatch: string | null; body: { definition: { steps: { command?: string }[] } } }[] = [];
    server.use(
      http.get(`*/api/runbooks/${RUNBOOK_ID}`, () =>
        HttpResponse.json({ data: makeDetail({ latestVersion: { ...makeDetail().latestVersion!, version } }) }),
      ),
      http.put(`*/api/runbooks/${RUNBOOK_ID}/definition`, async ({ request }) => {
        const ifMatch = request.headers.get('If-Match');
        puts.push({ ifMatch, body: (await request.json()) as never });
        if (ifMatch !== `"v${version}"`) return HttpResponse.json({ code: 'STALE', message: 'Stale' }, { status: 412 });
        version += 1;
        return HttpResponse.json({ data: { ...makeDetail({ latestVersion: { ...makeDetail().latestVersion!, version } }), created: true } });
      }),
    );
    renderEdit();
    const command = await screen.findByRole('textbox', { name: 'Command' });
    // Someone else saves v4 meanwhile.
    version = 4;
    await userEvent.clear(command);
    await userEvent.type(command, 'uptime');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog', { name: 'Someone saved a newer version' });
    expect(puts[0]!.ifMatch).toBe('"v3"');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]!.ifMatch).toBe('"v4"');
    expect(puts[1]!.body.definition.steps[0]!.command).toBe('uptime');
    expect(await screen.findByText('Saved version 5')).toBeInTheDocument();
  });

  it('Reload drops the local edits after a conflict', async () => {
    server.use(
      http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail() })),
      http.put(`*/api/runbooks/${RUNBOOK_ID}/definition`, () => HttpResponse.json({ code: 'STALE', message: 'Stale' }, { status: 412 })),
    );
    renderEdit();
    const command = await screen.findByRole('textbox', { name: 'Command' });
    await userEvent.type(command, ' -i');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Command' })).toHaveValue('df -h'));
  });

  it('adds a step of each kind from the menu and reorders with Alt+arrows', async () => {
    server.use(http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail() })));
    renderEdit();
    await screen.findByRole('textbox', { name: 'Command' });
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(7);
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Approval gate/ }));
    const list = screen.getByRole('list', { name: 'Steps' });
    let names = within(list).getAllByRole('button').filter((b) => /\d\. /.test(b.textContent ?? '')).map((b) => b.textContent);
    expect(names[0]).toMatch(/1\. Check disk/);
    expect(names[1]).toMatch(/2\. Wait for approval/);
    const second = within(list).getAllByRole('button').find((b) => /2\. /.test(b.textContent ?? ''))!;
    fireEvent.keyDown(second, { key: 'ArrowUp', altKey: true });
    names = within(list).getAllByRole('button').filter((b) => /\d\. /.test(b.textContent ?? '')).map((b) => b.textContent);
    expect(names[0]).toMatch(/1\. Wait for approval/);
    // The editor shows the gate's own fields.
    expect(screen.getByRole('textbox', { name: 'Message to the approver' })).toBeInTheDocument();
  });

  it('asks before leaving through a link with unsaved changes', async () => {
    server.use(http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail() })));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderEdit();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Command' }), ' -i');
    await userEvent.click(screen.getByRole('link', { name: 'Runbooks' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByText('detail page')).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('shows validation warnings inline on the step (the channel #67 uses)', async () => {
    const definition = makeDefinition();
    server.use(
      http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail({}, definition) })),
      http.post('*/api/runbooks/validate', () =>
        HttpResponse.json({
          data: { valid: true, definition, definitionSha256: 'a', warnings: [{ code: 'DESTRUCTIVE', path: ['steps', 0, 'command'], message: 'This command deletes data' }] },
        }),
      ),
    );
    renderEdit();
    await screen.findByRole('textbox', { name: 'Command' });
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByText('This command deletes data')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    server.use(http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail() })));
    const { container } = renderEdit();
    await screen.findByRole('textbox', { name: 'Command' });
    expect((await axe(container)).violations).toEqual([]);
  });
});
