import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import type { CommandHistory } from '../../../services/command-history-api';

// =============================================================================
// The key panel's History tab (#173): the list and the search, inserting without
// Enter, Save as snippet, masked entries, the states (loading, empty, no history
// file, SFTP unavailable, error) and the "history may lag" hint. The API is mocked
// at the services.
// =============================================================================

const api = vi.hoisted(() => ({ getCommandHistory: vi.fn(), createSnippet: vi.fn() }));

vi.mock('../../../services/command-history-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/command-history-api')>()),
  getCommandHistory: api.getCommandHistory,
}));
vi.mock('../../../services/snippets-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/snippets-api')>()),
  createSnippet: api.createSnippet,
}));

import { HistoryTab } from '../../../components/terminal/keys/history/HistoryTab';
import { TerminalKeyPanel } from '../../../components/terminal/keys/TerminalKeyPanel';
import { ApiError } from '../../../services/api';

const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const history = (entries: CommandHistory['entries'], extra: Partial<CommandHistory> = {}): CommandHistory => ({
  shell: 'bash',
  entries,
  truncated: false,
  dropped: 0,
  ...extra,
});
const ENTRIES = [
  { command: 'tail -f /var/log/app.log', masked: false },
  { command: 'export DB_PASS=[REDACTED:credential_assignment]', masked: true },
  { command: 'df -h', masked: false },
];

function renderTab(onInsert = vi.fn(() => 'inserted' as const), onTextEntry = vi.fn()) {
  render(<HistoryTab sessionId={SESSION} onInsert={onInsert} onTextEntry={onTextEntry} />);
  return { onInsert, onTextEntry };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCommandHistory.mockResolvedValue(history(ENTRIES));
});

describe('the History tab', () => {
  it('lists the commands in the order the API sent, asking for this session', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'Command history' });
    const items = within(list).getAllByRole('button', { name: /^Insert / });
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Insert tail -f /var/log/app.log',
      'Insert export DB_PASS=[REDACTED:credential_assignment]',
      'Insert df -h',
    ]);
    expect(api.getCommandHistory).toHaveBeenCalledWith(SESSION, '');
  });

  it('inserts on tap and never presses Enter', async () => {
    const { onInsert } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Insert df -h' }));
    expect(onInsert).toHaveBeenCalledWith('df -h', { confirmed: false });
    expect(onInsert.mock.calls.every(([text]) => !/[\r\n]$/.test(text as string))).toBe(true);
  });

  it('searches on the server after a pause in typing', async () => {
    const user = userEvent.setup();
    api.getCommandHistory.mockImplementation(async (_id: string, q?: string) =>
      history(ENTRIES.filter((e) => !q || e.command.includes(q))),
    );
    renderTab();
    await screen.findByRole('list', { name: 'Command history' });
    await user.type(screen.getByRole('searchbox', { name: 'Search history' }), 'df');
    await waitFor(() => expect(api.getCommandHistory).toHaveBeenLastCalledWith(SESSION, 'df'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Insert tail/ })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Insert df -h' })).toBeInTheDocument();
  });

  it('says so when a search matches nothing', async () => {
    const user = userEvent.setup();
    api.getCommandHistory.mockImplementation(async (_id: string, q?: string) => history(q ? [] : ENTRIES));
    renderTab();
    await screen.findByRole('list', { name: 'Command history' });
    await user.type(screen.getByRole('searchbox', { name: 'Search history' }), 'zzz');
    expect(await screen.findByText('No command matches.')).toBeInTheDocument();
  });

  it('asks before inserting a multi-line command the terminal cannot bracket', async () => {
    const user = userEvent.setup();
    api.getCommandHistory.mockResolvedValue(history([{ command: 'echo a\necho b', masked: false }]));
    const onInsert = vi.fn((_t: string, o?: { confirmed?: boolean }) => (o?.confirmed ? ('inserted' as const) : ('needs-confirmation' as const)));
    renderTab(onInsert as never);
    fireEvent.click(await screen.findByRole('button', { name: /^Insert echo a/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert a multi-line command?' });
    await user.click(within(dialog).getByRole('button', { name: 'Insert anyway' }));
    expect(onInsert).toHaveBeenLastCalledWith('echo a\necho b', { confirmed: true });
  });

  it('tells the user when there is no terminal to insert into', async () => {
    renderTab(vi.fn(() => 'unavailable' as const) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Insert df -h' }));
    expect(await screen.findByText('There is no open terminal to insert into.')).toBeInTheDocument();
  });

  it('saves a command as a snippet through the editor, prefilled with the command', async () => {
    const user = userEvent.setup();
    api.createSnippet.mockResolvedValue({
      id: 's', title: 'Disk', body: 'df -h', tags: [], position: 0, createdAt: '', updatedAt: '', warning: null,
    });
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Save as snippet: df -h' }));
    const dialog = await screen.findByRole('dialog', { name: 'New snippet' });
    expect(within(dialog).getByLabelText('Text')).toHaveValue('df -h');
    await user.type(within(dialog).getByLabelText('Title'), 'Disk');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createSnippet).toHaveBeenCalledWith({ title: 'Disk', body: 'df -h', tags: [] }));
    expect(await screen.findByText(/Saved “Disk” to your snippets/)).toBeInTheDocument();
  });

  it('shows the secret warning when the snippet API flags the text', async () => {
    const user = userEvent.setup();
    api.createSnippet.mockResolvedValue({
      id: 's', title: 'Tail', body: 'x', tags: [], position: 0, createdAt: '', updatedAt: '', warning: 'looks-like-secret',
    });
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Save as snippet: tail -f /var/log/app.log' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Tail');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('history-secret-warning')).toHaveTextContent('Tail');
  });

  it('marks a masked entry and offers no way to save it as a snippet', async () => {
    renderTab();
    await screen.findByRole('list', { name: 'Command history' });
    expect(screen.getByText('secret masked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save as snippet: export/ })).not.toBeInTheDocument();
  });

  it('shows the lag hint, the shell, the hidden count and the truncation', async () => {
    api.getCommandHistory.mockResolvedValue(history(ENTRIES, { dropped: 2, truncated: true }));
    renderTab();
    await screen.findByRole('list', { name: 'Command history' });
    const note = await screen.findByTestId('history-lag-note');
    expect(note).toHaveTextContent('From the bash history file.');
    expect(note).toHaveTextContent('History may lag until the shell exits');
    expect(note).toHaveTextContent('history -a');
    expect(note).toHaveTextContent('2 entries that looked like secrets are hidden');
    expect(note).toHaveTextContent('Older commands are not shown');
  });

  it('shows a spinner while loading', async () => {
    api.getCommandHistory.mockReturnValue(new Promise(() => undefined));
    renderTab();
    expect(await screen.findByLabelText('Loading history')).toBeInTheDocument();
  });

  it('says so when the server has no history file, and when the history is empty', async () => {
    api.getCommandHistory.mockResolvedValue(history([], { shell: null }));
    const first = render(<HistoryTab sessionId={SESSION} onInsert={vi.fn() as never} />);
    expect(await screen.findByText('No shell history file was found on this server yet.')).toBeInTheDocument();
    first.unmount();
    api.getCommandHistory.mockResolvedValue(history([]));
    render(<HistoryTab sessionId={SESSION} onInsert={vi.fn() as never} />);
    expect(await screen.findByText('There are no commands in the history yet.')).toBeInTheDocument();
  });

  it('explains when the server offers no SFTP, without a retry', async () => {
    api.getCommandHistory.mockRejectedValue(new ApiError('x', 502, 'SFTP_UNAVAILABLE'));
    renderTab();
    expect(await screen.findByText('History is read over SFTP, and this server does not offer it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows a generic error with Retry, which asks again', async () => {
    const user = userEvent.setup();
    api.getCommandHistory.mockRejectedValueOnce(new Error('boom'));
    renderTab();
    expect(await screen.findByText('Could not read the history from the server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Command history' })).toBeInTheDocument();
  });

  it('reports text entry while the search box has focus', async () => {
    const user = userEvent.setup();
    const { onTextEntry } = renderTab();
    await screen.findByRole('list', { name: 'Command history' });
    await user.click(screen.getByRole('searchbox', { name: 'Search history' }));
    expect(onTextEntry).toHaveBeenLastCalledWith(true);
  });
});

describe('the History tab in the key panel', () => {
  const panel = (props: Record<string, unknown>) =>
    render(
      <TerminalKeyPanel
        id="kp"
        variant="side"
        groups={[]}
        onClose={vi.fn()}
        {...({} as never)}
        {...props}
      />,
    );

  it('is drawn with a session and an insert handler, and lists the history when chosen', async () => {
    const user = userEvent.setup();
    panel({ sessionId: SESSION, onInsertSnippet: vi.fn(() => 'inserted') });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Keys', 'Snippets', 'History']);
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByRole('list', { name: 'Command history' })).toBeInTheDocument();
  });

  it('is not drawn without a session, or without a way to insert text', () => {
    panel({ onInsertSnippet: vi.fn() });
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
    panel({ sessionId: SESSION });
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
  });
});
