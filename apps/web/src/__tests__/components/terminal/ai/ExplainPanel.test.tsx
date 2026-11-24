import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { ExplainPanel } from '../../../../components/terminal/ai/ExplainPanel';
import { insertSuggestedCommand } from '../../../../components/terminal/ai/insertCommand';
import { ApiError } from '../../../../services/api';
import { previewTerminalExplain, streamTerminalExplain } from '../../../../services/terminal-explain-api';
import { acceptTerminalAiConsent, getTerminalAiConsent } from '../../../../services/terminal-api';
import type { TerminalViewHandle } from '../../../../components/terminal/TerminalView';

vi.mock('../../../../services/terminal-explain-api', () => ({
  streamTerminalExplain: vi.fn(),
  previewTerminalExplain: vi.fn(),
}));
vi.mock('../../../../services/terminal-api', () => ({
  getTerminalAiConsent: vi.fn(),
  acceptTerminalAiConsent: vi.fn(),
}));

type Handlers = Parameters<typeof streamTerminalExplain>[1];
const stream = vi.mocked(streamTerminalExplain);
const preview = vi.mocked(previewTerminalExplain);

const MARKDOWN = '## What happened\nThe unit failed.\n## Likely cause\nA bad config.\n## Suggested fix\nCheck the status.';

const answer = (suggestedCommand?: Record<string, unknown>) =>
  stream.mockImplementation(async (_req, h: Handlers) => {
    h.onContext?.({ findings: [], lines: 2, truncated: false });
    h.onDelta?.('## What');
    h.onResult?.({ markdown: MARKDOWN, ...(suggestedCommand ? { suggestedCommand } : {}) } as never);
  });

const SUGGESTION = { command: 'systemctl status app.service', risk: 'low', destructive: false, reasons: [] as string[] };

function renderPanel(props: Partial<React.ComponentProps<typeof ExplainPanel>> = {}) {
  const onInsert = vi.fn();
  render(<ExplainPanel sessionId="s1" onInsert={onInsert} getSelection={() => ''} {...props} />);
  return onInsert;
}

describe('ExplainPanel (#58)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue({ text: 'login: password=[REDACTED:kv_secret]', findings: [{ kind: 'kv_secret', count: 1 }], truncated: false });
  });

  it('a selection shows What will be sent first and sends only after confirmation', async () => {
    answer();
    renderPanel({ trigger: { id: 1, mode: 'selection', selection: 'login: password=abc' } });
    const text = await screen.findByTestId('explain-preview-text');
    expect(text).toHaveTextContent('password=[REDACTED:kv_secret]');
    expect(screen.getByText(/Redacted 1 item/)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({ mode: 'selection', sessionId: 's1', selection: 'login: password=abc' });
    expect(stream).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Send for explanation' }));
    expect(await screen.findByTestId('explain-result')).toBeInTheDocument();
    expect(stream.mock.calls[0]![0]).toEqual({ mode: 'selection', sessionId: 's1', selection: 'login: password=abc' });
  });

  it('the last error is sent at once and its preview loads only on demand', async () => {
    answer();
    renderPanel({ trigger: { id: 1, mode: 'last_error' } });
    expect(await screen.findByRole('heading', { name: 'What happened' })).toBeInTheDocument();
    expect(stream.mock.calls[0]![0]).toEqual({ mode: 'last_error', sessionId: 's1' });
    expect(preview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'What will be sent' }));
    expect(await screen.findByTestId('explain-preview-text')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({ mode: 'last_error', sessionId: 's1' });
  });

  it('renders the answer as markdown without HTML', async () => {
    stream.mockImplementation(async (_req, h: Handlers) => {
      h.onResult?.({ markdown: '## What happened\n<img src=x onerror=alert(1)>' });
    });
    const { container } = render(<ExplainPanel sessionId="s1" onInsert={vi.fn()} getSelection={() => ''} trigger={{ id: 1, mode: 'last_error' }} />);
    expect(await screen.findByRole('heading', { name: 'What happened' })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the suggested fix with its server-computed risk and Insert hands it over once', async () => {
    answer({ ...SUGGESTION, risk: 'high', destructive: true, reasons: ['Deletes things'] });
    const onInsert = renderPanel({ trigger: { id: 1, mode: 'last_error' } });
    expect(await screen.findByLabelText('Suggested command')).toHaveTextContent('systemctl status app.service');
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('Destructive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith('systemctl status app.service');
  });

  it('the Insert path pastes the fix with no newline and never sends input', () => {
    const paste = vi.fn();
    const sendInput = vi.fn();
    const view = { getTerminal: () => ({ paste }), focus: vi.fn(), sendInput } as unknown as TerminalViewHandle;
    expect(insertSuggestedCommand(view, 'systemctl status app.service')).toBe(true);
    expect(paste).toHaveBeenCalledWith('systemctl status app.service');
    expect(String(paste.mock.calls[0]![0])).not.toMatch(/[\r\n]/);
    expect(sendInput).not.toHaveBeenCalled();
    // A fix with a control character is refused whole.
    expect(insertSuggestedCommand(view, 'ls\n')).toBe(false);
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it('a fix with a control character cannot be inserted', async () => {
    answer({ ...SUGGESTION, command: 'ls\u001b[2J' });
    renderPanel({ trigger: { id: 1, mode: 'last_error' } });
    expect(await screen.findByRole('button', { name: 'Insert' })).toBeDisabled();
  });

  it('Explain selection with nothing selected asks the user to select, and calls nothing', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Explain selection' }));
    expect(screen.getByRole('status')).toHaveTextContent('Select some terminal text');
    expect(preview).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('the panel buttons start a selection preview and the last error', async () => {
    answer();
    renderPanel({ getSelection: () => 'some output' });
    await userEvent.click(screen.getByRole('button', { name: 'Explain selection' }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ mode: 'selection', sessionId: 's1', selection: 'some output' }));
    await userEvent.click(screen.getByRole('button', { name: 'Explain last error' }));
    await waitFor(() => expect(stream.mock.calls[0]![0]).toEqual({ mode: 'last_error', sessionId: 's1' }));
  });

  it('a trigger is taken once and reported handled', async () => {
    answer();
    const onTriggerHandled = vi.fn();
    const { rerender } = render(
      <ExplainPanel sessionId="s1" onInsert={vi.fn()} getSelection={() => ''} trigger={{ id: 1, mode: 'last_error' }} onTriggerHandled={onTriggerHandled} />,
    );
    await waitFor(() => expect(onTriggerHandled).toHaveBeenCalledTimes(1));
    rerender(<ExplainPanel sessionId="s1" onInsert={vi.fn()} getSelection={() => ''} trigger={{ id: 1, mode: 'last_error' }} onTriggerHandled={onTriggerHandled} />);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('a server that shares no output explains why', async () => {
    stream.mockRejectedValue(new ApiError('no', 409, 'AI_OUTPUT_SHARING_DISABLED'));
    renderPanel({ trigger: { id: 1, mode: 'last_error' } });
    expect(await screen.findByText('This server is set to never send terminal output to AI.')).toBeInTheDocument();
  });

  it('asks for consent on AI_CONSENT_REQUIRED and re-runs after it is accepted', async () => {
    stream.mockRejectedValueOnce(new ApiError('consent', 409, 'AI_CONSENT_REQUIRED'));
    answer();
    vi.mocked(getTerminalAiConsent).mockResolvedValue({ redactionMode: 'standard' } as never);
    vi.mocked(acceptTerminalAiConsent).mockResolvedValue({ consentAcceptedAt: 'now' });
    renderPanel({ trigger: { id: 1, mode: 'last_error' } });
    const accept = await screen.findByRole('button', { name: /I understand/ });
    await userEvent.click(accept);
    await waitFor(() => expect(acceptTerminalAiConsent).toHaveBeenCalled());
    expect(await screen.findByTestId('explain-result')).toBeInTheDocument();
  });

  it('shows an in-band error code as text', async () => {
    stream.mockImplementation(async (_req, h: Handlers) => h.onError?.('AI_EXPLAIN_EMPTY'));
    renderPanel({ trigger: { id: 1, mode: 'last_error' } });
    expect(await screen.findByText('The assistant returned no answer. Try again.')).toBeInTheDocument();
  });
});
