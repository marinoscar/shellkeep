import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import { SessionSummaryPanel } from '../../../../components/terminal/ai/SessionSummaryPanel';
import { SUMMARY_POLL_MS } from '../../../../hooks/useSessionSummary';
import { ApiError } from '../../../../services/api';
import {
  getSessionSummary,
  listSessionSummaries,
  requestSessionSummary,
  type SessionSummary,
} from '../../../../services/session-summary-api';
import { acceptTerminalAiConsent, getTerminalAiConsent } from '../../../../services/terminal-api';

vi.mock('../../../../services/session-summary-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/session-summary-api')>()),
  requestSessionSummary: vi.fn(),
  getSessionSummary: vi.fn(),
  listSessionSummaries: vi.fn(),
}));
vi.mock('../../../../services/terminal-api', () => ({
  getTerminalAiConsent: vi.fn(),
  acceptTerminalAiConsent: vi.fn(),
}));

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'sum-1',
  sessionId: 's1',
  jobId: 'job-1',
  status: 'pending',
  summaryMd: null,
  commands: null,
  findings: null,
  sourceChars: null,
  truncated: false,
  model: null,
  errorCode: null,
  createdAt: '2026-11-24T10:00:00.000Z',
  completedAt: null,
  ...over,
});

const done = summary({
  status: 'succeeded',
  summaryMd: '## What was done\nChecked disk usage.',
  commands: [{ command: 'df -h', outcome: 'ok' }],
  model: 'model-x',
  findings: [{ kind: 'aws_access_key', count: 2 }],
});

describe('SessionSummaryPanel (#59)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSessionSummaries).mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('asks once, polls every 3 s until the summary settles, then renders it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(requestSessionSummary).mockResolvedValue({ summaryId: 'sum-1', jobId: 'job-1', status: 'pending' });
    vi.mocked(getSessionSummary).mockResolvedValueOnce(summary()).mockResolvedValueOnce(summary()).mockResolvedValue(done);

    render(<SessionSummaryPanel sessionId="s1" sessionName="main" />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Summarize' }));

    expect(requestSessionSummary).toHaveBeenCalledWith('s1');
    expect(await screen.findByLabelText('Summarizing')).toBeInTheDocument();
    expect(getSessionSummary).toHaveBeenCalledTimes(1);

    await act(async () => void (await vi.advanceTimersByTimeAsync(SUMMARY_POLL_MS)));
    expect(getSessionSummary).toHaveBeenCalledTimes(2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(SUMMARY_POLL_MS)));
    expect(getSessionSummary).toHaveBeenCalledTimes(3);

    expect(await screen.findByTestId('session-summary-result')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What was done' })).toBeInTheDocument();
    expect(screen.getByText('df -h')).toBeInTheDocument();
    expect(screen.getByText('2 item(s) redacted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download .md' })).toBeInTheDocument();

    // Settled: no further polling.
    await act(async () => void (await vi.advanceTimersByTimeAsync(SUMMARY_POLL_MS * 3)));
    expect(getSessionSummary).toHaveBeenCalledTimes(3);
  });

  it('copies the summary as Markdown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(requestSessionSummary).mockResolvedValue({ summaryId: 'sum-1', jobId: null, status: 'pending' });
    vi.mocked(getSessionSummary).mockResolvedValue(done);
    render(<SessionSummaryPanel sessionId="s1" sessionName="main" />);
    await userEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String(writeText.mock.calls[0]![0]);
    expect(text).toContain('# Session summary: main');
    expect(text).toContain('Checked disk usage.');
    expect(text).toContain('`df -h` (ok)');
  });

  it('shows a clear message for a failed summary and for a server that does not share output', async () => {
    vi.mocked(requestSessionSummary).mockResolvedValue({ summaryId: 'sum-1', jobId: null, status: 'pending' });
    vi.mocked(getSessionSummary).mockResolvedValue(summary({ status: 'failed', errorCode: 'AI_OUTPUT_SHARING_DISABLED' }));
    render(<SessionSummaryPanel sessionId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    expect(await screen.findByText(/never send terminal output to AI/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarize again' })).toBeEnabled();
  });

  it('shows the API error when the request is refused', async () => {
    vi.mocked(requestSessionSummary).mockRejectedValue(
      new ApiError('The session has ended', 400, 'SESSION_TERMINATED'),
    );
    render(<SessionSummaryPanel sessionId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    expect(await screen.findByText('This session has ended, so it cannot be summarized.')).toBeInTheDocument();
  });

  it('asks for consent on 409 AI_CONSENT_REQUIRED and asks again once accepted', async () => {
    vi.mocked(requestSessionSummary)
      .mockRejectedValueOnce(new ApiError('consent', 409, 'AI_CONSENT_REQUIRED'))
      .mockResolvedValue({ summaryId: 'sum-1', jobId: null, status: 'pending' });
    vi.mocked(getTerminalAiConsent).mockResolvedValue({ required: true, consentAcceptedAt: null, redactionMode: 'standard' });
    vi.mocked(acceptTerminalAiConsent).mockResolvedValue({ consentAcceptedAt: '2026-11-24T10:00:00Z' });
    vi.mocked(getSessionSummary).mockResolvedValue(done);

    render(<SessionSummaryPanel sessionId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(screen.getAllByRole('button').find((b) => /accept|agree|continue/i.test(b.textContent ?? '') && dialog.contains(b))!);
    expect(acceptTerminalAiConsent).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('session-summary-result')).toBeInTheDocument();
    expect(requestSessionSummary).toHaveBeenCalledTimes(2);
  });

  it('lists earlier summaries and reopens one', async () => {
    vi.mocked(listSessionSummaries).mockResolvedValue([done]);
    render(<SessionSummaryPanel sessionId="s1" />);
    await userEvent.click(await screen.findByRole('button', { name: /\(succeeded\)/ }));
    expect(await screen.findByTestId('session-summary-result')).toBeInTheDocument();
  });

  it('disables the action without a session', () => {
    render(<SessionSummaryPanel sessionId={null} />);
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled();
  });
});
