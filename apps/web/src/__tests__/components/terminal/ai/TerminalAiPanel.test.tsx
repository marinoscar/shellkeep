import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { TerminalAiPanel } from '../../../../components/terminal/ai/TerminalAiPanel';

vi.mock('../../../../services/terminal-assist-api', () => ({ streamCommandAssist: vi.fn() }));
vi.mock('../../../../services/session-summary-api', () => ({
  requestSessionSummary: vi.fn(),
  getSessionSummary: vi.fn(),
  listSessionSummaries: vi.fn().mockResolvedValue([]),
  summaryToMarkdown: vi.fn(() => ''),
}));
vi.mock('../../../../services/terminal-explain-api', () => ({ streamTerminalExplain: vi.fn(), previewTerminalExplain: vi.fn() }));
vi.mock('../../../../services/terminal-api', () => ({
  getTerminalAiConsent: vi.fn(),
  acceptTerminalAiConsent: vi.fn(),
}));

describe('terminal AI panel (#77, #57, #58, #59)', () => {
  it('Suggest, Explain and Summarize are all live', async () => {
    render(<TerminalAiPanel open variant="side" onClose={vi.fn()} onInsert={vi.fn()} sessionId="s1" />);
    // Nothing typed yet: Suggest is disabled for that reason, not "coming soon".
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled();
    expect(screen.queryByText('Coming with Terminal AI')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Describe a command'), 'list files');
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Explain' }));
    expect(screen.getByRole('button', { name: 'Explain selection' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Explain last error' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Summarize session' }));
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeEnabled();
    expect(screen.queryByText('Coming with Terminal AI')).not.toBeInTheDocument();
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
