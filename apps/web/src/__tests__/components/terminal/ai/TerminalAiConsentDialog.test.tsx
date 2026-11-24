import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { TerminalAiConsentDialog } from '../../../../components/terminal/ai/TerminalAiConsentDialog';

describe('TerminalAiConsentDialog', () => {
  it('states what is sent and that redaction is best effort', () => {
    render(<TerminalAiConsentDialog open onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Send terminal output to AI?')).toBeInTheDocument();
    expect(screen.getByText(/operating system, shell and current directory/)).toBeInTheDocument();
    expect(screen.getByText(/best effort, not a guarantee/)).toBeInTheDocument();
    expect(screen.getByText(/Send terminal output to AI/, { selector: 'strong' })).toBeInTheDocument();
  });

  it('mentions line dropping only in strict mode', () => {
    const { rerender } = render(<TerminalAiConsentDialog open onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/drops every line/)).not.toBeInTheDocument();
    rerender(<TerminalAiConsentDialog open redactionMode="strict" onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/drops every line/)).toBeInTheDocument();
  });

  it('accepts and cancels', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onCancel = vi.fn();
    render(<TerminalAiConsentDialog open onAccept={onAccept} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'I understand, continue' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy and shows an error', () => {
    render(<TerminalAiConsentDialog open busy error="Could not save" onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'I understand, continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    expect(screen.getByText('Could not save')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<TerminalAiConsentDialog open={false} onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('Send terminal output to AI?')).not.toBeInTheDocument();
  });
});
