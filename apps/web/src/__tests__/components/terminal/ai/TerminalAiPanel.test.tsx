import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { TerminalAiPanel } from '../../../../components/terminal/ai/TerminalAiPanel';

vi.mock('../../../../services/terminal-assist-api', () => ({ streamCommandAssist: vi.fn() }));
vi.mock('../../../../services/terminal-api', () => ({
  getTerminalAiConsent: vi.fn(),
  acceptTerminalAiConsent: vi.fn(),
}));

describe('terminal AI panel (#77, #57)', () => {
  it('Suggest is live; Explain and Summarize stay disabled until their APIs ship', async () => {
    render(<TerminalAiPanel open variant="side" onClose={vi.fn()} onInsert={vi.fn()} sessionId="s1" />);
    // Nothing typed yet: Suggest is disabled for that reason, not "coming soon".
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled();
    expect(screen.queryByText('Coming with Terminal AI')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Describe a command'), 'list files');
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Explain' }));
    expect(screen.getAllByRole('button', { name: 'Explain' }).at(-1)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Summarize session' }));
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled();
    expect(screen.getByText('Coming with Terminal AI')).toBeInTheDocument();
  });

  it('is a bottom sheet in the sheet variant', () => {
    render(<TerminalAiPanel open variant="sheet" onClose={vi.fn()} onInsert={vi.fn()} sessionId="s1" />);
    expect(screen.getByRole('presentation')).toBeInTheDocument();
  });

  it('renders nothing docked while closed', () => {
    render(<TerminalAiPanel open={false} variant="side" onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();
  });
});
