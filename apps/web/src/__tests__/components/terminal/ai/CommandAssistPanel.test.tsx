import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { CommandAssistPanel } from '../../../../components/terminal/ai/CommandAssistPanel';
import { insertSuggestedCommand } from '../../../../components/terminal/ai/insertCommand';
import { ApiError } from '../../../../services/api';
import { streamCommandAssist } from '../../../../services/terminal-assist-api';
import { acceptTerminalAiConsent, getTerminalAiConsent } from '../../../../services/terminal-api';
import type { TerminalViewHandle } from '../../../../components/terminal/TerminalView';

vi.mock('../../../../services/terminal-assist-api', () => ({ streamCommandAssist: vi.fn() }));
vi.mock('../../../../services/terminal-api', () => ({
  getTerminalAiConsent: vi.fn(),
  acceptTerminalAiConsent: vi.fn(),
}));

type Handlers = Parameters<typeof streamCommandAssist>[1];
const stream = vi.mocked(streamCommandAssist);

const result = (overrides: Record<string, unknown> = {}) => ({
  command: 'du -ah /var | sort -rh | head -n 10',
  explanation: 'Lists the ten largest entries.',
  risk: 'low' as const,
  destructive: false,
  reasons: [] as string[],
  ...overrides,
});

const answer = (frame: ReturnType<typeof result>) =>
  stream.mockImplementation(async (_req, h: Handlers) => {
    h.onContext?.({ os: 'linux', shell: '/bin/bash', cwd: '/srv/app', screenLines: 12, findings: [] });
    h.onDelta?.('COMMAND: ');
    h.onResult?.(frame);
  });

async function ask(onInsert = vi.fn()) {
  render(<CommandAssistPanel sessionId="s1" onInsert={onInsert} />);
  await userEvent.type(screen.getByLabelText('Describe a command'), 'largest files in /var');
  await userEvent.click(screen.getByRole('button', { name: 'Suggest' }));
  return onInsert;
}

describe('CommandAssistPanel (#57)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the command in monospace with a risk chip and what was sent', async () => {
    answer(result());
    await ask();
    expect(await screen.findByLabelText('Suggested command')).toHaveTextContent('du -ah /var | sort -rh | head -n 10');
    expect(screen.getByText('Low risk')).toBeInTheDocument();
    expect(screen.queryByText('Destructive')).not.toBeInTheDocument();
    expect(screen.getByTestId('assist-context')).toHaveTextContent('linux');
    expect(stream.mock.calls[0]![0]).toEqual({ sessionId: 's1', prompt: 'largest files in /var', includeScreen: true });
  });

  it('a destructive command shows a red Destructive chip and its reasons', async () => {
    answer(result({ command: 'rm -rf /', risk: 'high', destructive: true, reasons: ['Recursively deletes the root'] }));
    await ask();
    expect(await screen.findByText('Destructive')).toBeInTheDocument();
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('Recursively deletes the root')).toBeInTheDocument();
  });

  it('Insert hands the command over once and nothing runs it; Copy and Regenerate are offered', async () => {
    answer(result());
    const onInsert = await ask();
    await userEvent.click(await screen.findByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith('du -ah /var | sort -rh | head -n 10');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('through the page path: Insert pastes once with no newline and sends no input to the PTY', async () => {
    answer(result());
    const paste = vi.fn();
    const view = { getTerminal: () => ({ paste }), sendInput: vi.fn(), focus: vi.fn(), reconnect: vi.fn() } as unknown as TerminalViewHandle;
    render(<CommandAssistPanel sessionId="s1" onInsert={(c) => insertSuggestedCommand(view, c)} />);
    await userEvent.type(screen.getByLabelText('Describe a command'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Insert' }));
    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste.mock.calls[0]![0]).toBe('du -ah /var | sort -rh | head -n 10');
    expect(paste.mock.calls[0]![0]).not.toMatch(/[\r\n]/);
    expect(view.sendInput).not.toHaveBeenCalled();
  });

  it('disables Insert for a command with a control character but still offers Copy', async () => {
    answer(result({ command: 'ls\x1b[2J' }));
    await ask();
    expect(await screen.findByRole('button', { name: 'Insert' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('sends includeScreen=false when the switch is off', async () => {
    answer(result());
    render(<CommandAssistPanel sessionId="s1" onInsert={vi.fn()} />);
    await userEvent.click(screen.getByRole('switch'));
    await userEvent.type(screen.getByLabelText('Describe a command'), 'pwd');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    expect(stream.mock.calls[0]![0].includeScreen).toBe(false);
  });

  it('explains an unparseable answer', async () => {
    stream.mockImplementation(async (_r, h: Handlers) => h.onError?.('AI_ASSIST_UNPARSEABLE'));
    await ask();
    expect(await screen.findByText(/could not be read as a single command/)).toBeInTheDocument();
  });

  it('asks for consent on 409 AI_CONSENT_REQUIRED, then retries the same question after acceptance', async () => {
    stream.mockRejectedValueOnce(new ApiError('consent', 409, 'AI_CONSENT_REQUIRED'));
    answer(result());
    stream.mockRejectedValueOnce(new ApiError('consent', 409, 'AI_CONSENT_REQUIRED'));
    vi.mocked(getTerminalAiConsent).mockResolvedValue({ required: true, consentAcceptedAt: null, redactionMode: 'standard' });
    vi.mocked(acceptTerminalAiConsent).mockResolvedValue({ consentAcceptedAt: '2026-11-24T10:00:00.000Z' });
    stream.mockReset();
    stream.mockRejectedValueOnce(new ApiError('consent', 409, 'AI_CONSENT_REQUIRED')).mockImplementation(async (_r, h: Handlers) => {
      h.onResult?.(result());
    });
    await ask();
    await userEvent.click(await screen.findByRole('button', { name: 'I understand, continue' }));
    await waitFor(() => expect(acceptTerminalAiConsent).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText('Suggested command')).toBeInTheDocument();
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]![0].prompt).toBe('largest files in /var');
  });
});
