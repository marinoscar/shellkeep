import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { AiSuggestionCard, TerminalAiPanel } from '../../../../components/terminal/ai/TerminalAiPanel';
import { insertSuggestedCommand, toInsertableCommand } from '../../../../components/terminal/ai/insertCommand';
import type { TerminalViewHandle } from '../../../../components/terminal/TerminalView';

describe('terminal AI panel (#77)', () => {
  it('Insert never sends a newline: sendInput gets the command with no \\r or \\n', () => {
    const view = { sendInput: vi.fn(), focus: vi.fn(), getTerminal: () => null, reconnect: vi.fn() } as TerminalViewHandle;
    expect(insertSuggestedCommand(view, 'systemctl status app --no-pager\r\n')).toBe(true);
    expect(view.sendInput).toHaveBeenCalledWith('systemctl status app --no-pager');
    const sent = vi.mocked(view.sendInput).mock.calls[0][0];
    expect(sent).not.toMatch(/[\r\n]/);
    expect(view.focus).toHaveBeenCalled();
    expect(toInsertableCommand('a\nb\r\nc\r')).toBe('a b c');
    expect(insertSuggestedCommand(view, '\n')).toBe(false);
    expect(insertSuggestedCommand(null, 'ls')).toBe(false);
  });

  it('the suggestion card hands the edited command to onInsert', async () => {
    const onInsert = vi.fn();
    render(<AiSuggestionCard command="ls -la" onInsert={onInsert} />);
    const field = screen.getByLabelText('Suggested command');
    await userEvent.type(field, ' /tmp');
    await userEvent.click(screen.getByRole('button', { name: 'Insert into terminal' }));
    expect(onInsert).toHaveBeenCalledWith('ls -la /tmp');
    expect(screen.getByText('Insert never runs it. You press Enter.')).toBeInTheDocument();
  });

  it('renders the three actions disabled until their APIs ship', async () => {
    render(<TerminalAiPanel open variant="side" onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Explain' }));
    expect(screen.getByRole('button', { name: 'Explain' , pressed: true })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Explain' }).at(-1)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Summarize session' }));
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled();
    expect(screen.getByText('Coming with Terminal AI')).toBeInTheDocument();
  });

  it('is a bottom sheet in the sheet variant and inserts from a suggestion', async () => {
    const onInsert = vi.fn();
    render(<TerminalAiPanel open variant="sheet" onClose={vi.fn()} onInsert={onInsert} suggestion="df -h" />);
    expect(screen.getByRole('presentation')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Insert into terminal' }));
    expect(onInsert).toHaveBeenCalledWith('df -h');
  });

  it('renders nothing docked while closed', () => {
    render(<TerminalAiPanel open={false} variant="side" onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();
  });
});
