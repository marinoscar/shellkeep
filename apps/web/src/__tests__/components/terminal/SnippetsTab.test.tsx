import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import type { Snippet } from '../../../services/snippets-api';

// =============================================================================
// The key panel's Snippets tab (#172): the list and the search, inserting without
// Enter, the {{placeholder}} form, create, edit, delete and reorder, the secret
// warning and the multi-line confirmation. The API is mocked at the service.
// =============================================================================

const api = vi.hoisted(() => ({
  listSnippets: vi.fn(),
  createSnippet: vi.fn(),
  updateSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
  reorderSnippets: vi.fn(),
}));

vi.mock('../../../services/snippets-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/snippets-api')>()),
  ...api,
}));

import { SnippetsTab } from '../../../components/terminal/keys/snippets/SnippetsTab';

const snippet = (id: string, title: string, body: string, tags: string[] = [], position = 0): Snippet => ({
  id,
  title,
  body,
  tags,
  position,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const A = snippet('a', 'Disk usage', 'df -h', ['disk'], 0);
const B = snippet('b', 'Tail logs', 'tail -f /var/log/app.log\n# second line', [], 1);
const C = snippet('c', 'SSH hop', 'ssh {{user}}@{{host}}', [], 2);

function renderTab(onInsert = vi.fn(() => 'inserted' as const), onTextEntry = vi.fn()) {
  render(<SnippetsTab onInsert={onInsert} onTextEntry={onTextEntry} />);
  return { onInsert, onTextEntry };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listSnippets.mockImplementation(async (query?: string) =>
    [A, B, C].filter((s) => !query || `${s.title} ${s.body}`.toLowerCase().includes(query.toLowerCase())),
  );
});

describe('the Snippets tab', () => {
  it('lists the snippets in order with a preview and tags', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'Snippets' });
    const items = within(list).getAllByRole('button');
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Insert Disk usage', 'Insert Tail logs', 'Insert SSH hop']);
    expect(within(list).getByText('tail -f /var/log/app.log (+1 more)')).toBeInTheDocument();
    expect(within(list).getByText('disk')).toBeInTheDocument();
  });

  it('searches on the server after a pause in typing', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.type(screen.getByRole('searchbox', { name: 'Search snippets' }), 'tail');
    await waitFor(() => expect(api.listSnippets).toHaveBeenLastCalledWith('tail'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Insert Disk usage' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Insert Tail logs' })).toBeInTheDocument();
  });

  it('says so when nothing matches, and offers to add the first snippet when there are none', async () => {
    api.listSnippets.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/No snippets yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a snippet' })).toBeInTheDocument();
  });

  it('inserts a snippet on tap and never presses Enter', async () => {
    const { onInsert } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Insert Disk usage' }));
    expect(onInsert).toHaveBeenCalledWith('df -h', { confirmed: false });
    expect(onInsert.mock.calls.every(([text]) => !/[\r\n]$/.test(text as string))).toBe(true);
  });

  it('asks for the {{placeholder}} values first, then inserts the filled text', async () => {
    const user = userEvent.setup();
    const { onInsert } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Insert SSH hop' }));
    const dialog = await screen.findByRole('dialog');
    expect(onInsert).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('user'), 'person-a');
    await user.type(within(dialog).getByLabelText('host'), 'server-a.example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledWith('ssh person-a@server-a.example.test', { confirmed: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancelling the placeholder form inserts nothing', async () => {
    const user = userEvent.setup();
    const { onInsert } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Insert SSH hop' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('asks before inserting a multi-line snippet the terminal cannot bracket, then inserts when confirmed', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn((_text: string, options?: { confirmed?: boolean }) =>
      options?.confirmed ? ('inserted' as const) : ('needs-confirmation' as const),
    );
    renderTab(onInsert as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Insert Tail logs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert a multi-line snippet?' });
    await user.click(within(dialog).getByRole('button', { name: 'Insert anyway' }));
    expect(onInsert).toHaveBeenLastCalledWith(B.body, { confirmed: true });
  });

  it('tells the user when there is no terminal to insert into', async () => {
    renderTab(vi.fn(() => 'unavailable' as const) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Insert Disk usage' }));
    expect(await screen.findByText('There is no open terminal to insert into.')).toBeInTheDocument();
  });

  it('creates a snippet from the editor and reloads the list', async () => {
    const user = userEvent.setup();
    api.createSnippet.mockResolvedValue({ ...snippet('d', 'New one', 'echo hi'), warning: null });
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'New snippet' }));
    const dialog = await screen.findByRole('dialog', { name: 'New snippet' });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Title'), 'New one');
    await user.type(within(dialog).getByLabelText('Text'), 'echo hi');
    await user.type(within(dialog).getByLabelText('Tags'), 'a, b, a');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createSnippet).toHaveBeenCalledWith({ title: 'New one', body: 'echo hi', tags: ['a', 'b'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.listSnippets.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('snippet-secret-warning')).not.toBeInTheDocument();
  });

  it('shows the secret warning when the API flags the saved text', async () => {
    const user = userEvent.setup();
    api.createSnippet.mockResolvedValue({ ...snippet('d', 'Database', 'mysql --password=hunter22'), warning: 'looks-like-secret' });
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'New snippet' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Database');
    await user.type(within(dialog).getByLabelText('Text'), 'mysql --password=hunter22');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const warning = await screen.findByTestId('snippet-secret-warning');
    expect(warning).toHaveTextContent('Database');
    expect(warning).toHaveTextContent('looks like it contains a password');
  });

  it('refuses a text over the byte cap before saving', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'New snippet' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Big');
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'x'.repeat(4097) } });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits a snippet from Manage', async () => {
    const user = userEvent.setup();
    api.updateSnippet.mockResolvedValue({ ...A, title: 'Disks', warning: null });
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    await user.click(screen.getByRole('button', { name: 'Edit Disk usage' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit snippet' });
    const title = within(dialog).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Disks');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSnippet).toHaveBeenCalledWith('a', { title: 'Disks', body: 'df -h', tags: ['disk'] }));
  });

  it('deletes a snippet after a confirmation', async () => {
    const user = userEvent.setup();
    api.deleteSnippet.mockResolvedValue(undefined);
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    await user.click(screen.getByRole('button', { name: 'Delete Tail logs' }));
    const dialog = await screen.findByRole('dialog');
    expect(api.deleteSnippet).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteSnippet).toHaveBeenCalledWith('b'));
  });

  it('moves a snippet down and saves the new order, and the first and last cannot move out', async () => {
    const user = userEvent.setup();
    api.reorderSnippets.mockImplementation(async (ids: string[]) =>
      ids.map((id, index) => ({ ...[A, B, C].find((s) => s.id === id)!, position: index })),
    );
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    expect(screen.getByRole('button', { name: 'Move Disk usage up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move SSH hop down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Disk usage down' }));
    await waitFor(() => expect(api.reorderSnippets).toHaveBeenCalledWith(['b', 'a', 'c']));
    await waitFor(() =>
      expect(screen.getAllByRole('listitem').map((li) => li.textContent?.match(/^(Tail logs|Disk usage|SSH hop)/)?.[1])).toEqual(['Tail logs', 'Disk usage', 'SSH hop']),
    );
  });

  it('puts the list back and says so when the order cannot be saved', async () => {
    const user = userEvent.setup();
    api.reorderSnippets.mockRejectedValue(new Error('Network down'));
    renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    await user.click(screen.getByRole('button', { name: 'Move Disk usage down' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Disk usage');
  });

  it('shows a load failure with a retry', async () => {
    const user = userEvent.setup();
    api.listSnippets.mockRejectedValueOnce(new Error('Could not reach the server'));
    renderTab();
    expect(await screen.findByText('Could not reach the server')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Snippets' })).toBeInTheDocument();
  });

  it('reports text entry while the search box has focus or a dialog is open', async () => {
    const user = userEvent.setup();
    const { onTextEntry } = renderTab();
    await screen.findByRole('list', { name: 'Snippets' });
    await user.click(screen.getByRole('searchbox', { name: 'Search snippets' }));
    expect(onTextEntry).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'New snippet' }));
    await screen.findByRole('dialog');
    expect(onTextEntry).toHaveBeenLastCalledWith(true);
  });
});
