import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Typography } from '@mui/material';
import { ContentCopy as CopyIcon, Download as DownloadIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { useSessionSummary } from '../../../hooks/useSessionSummary';
import {
  listSessionSummaries,
  summaryToMarkdown,
  type SessionSummary,
} from '../../../services/session-summary-api';
import { acceptTerminalAiConsent, getTerminalAiConsent } from '../../../services/terminal-api';
import { SafeMarkdown } from './SafeMarkdown';
import { TerminalAiConsentDialog } from './TerminalAiConsentDialog';

const ERROR_TEXT: Record<string, string> = {
  AI_OUTPUT_SHARING_DISABLED: 'This server is set to never send terminal output to AI, so it cannot be summarized.',
  AI_CONSENT_REQUIRED: 'Accept the terminal AI notice to summarize a session.',
  SESSION_TERMINATED: 'This session has ended, so it cannot be summarized.',
  SESSION_NOT_FOUND: 'This session no longer exists.',
  SESSION_EMPTY: 'The session has no output to summarize yet.',
  SUMMARY_TIMED_OUT: 'The summary did not finish. Try again.',
  AI_DISABLED: 'AI is turned off for this deployment.',
  AI_KEY_REQUIRED: 'Add your AI key in Settings to summarize sessions.',
  AI_RATE_LIMITED: 'The AI provider is rate limiting requests. Try again shortly.',
};

const errorText = (code: string | null, message: string | null): string =>
  (code && ERROR_TEXT[code]) || message || 'The summary could not be written.';

/** Downloads text as a file. A no-op where `URL.createObjectURL` is missing. */
function downloadText(filename: string, text: string): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const fileName = (sessionName: string | undefined): string =>
  `${(sessionName ?? 'session').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session'}-summary.md`;

/** A finished summary: the Markdown, the commands, the facts about it, Copy and Download. Exported for tests. */
export function SummaryResult({ summary, sessionName }: { summary: SessionSummary; sessionName?: string }) {
  const redacted = (summary.findings ?? []).reduce((n, f) => n + f.count, 0);
  const markdown = summaryToMarkdown(summary, sessionName);
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="session-summary-result">
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {summary.model && <Chip size="small" variant="outlined" label={summary.model} />}
        {redacted > 0 && <Chip size="small" variant="outlined" label={`${redacted} item(s) redacted`} />}
      </Box>
      {summary.truncated && (
        <Alert severity="info" variant="outlined" sx={{ typography: 'caption' }}>
          Only the most recent part of a very long session was summarized.
        </Alert>
      )}
      <SafeMarkdown source={summary.summaryMd ?? ''} />
      {summary.commands && summary.commands.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="subtitle2">Commands</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }} aria-label="Commands run">
            {summary.commands.map((entry, index) => (
              <Typography component="li" variant="body2" key={index} sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {entry.command}
                {entry.outcome && (
                  <Typography component="span" variant="caption" color={entry.outcome === 'error' ? 'error' : 'text.secondary'}>
                    {` (${entry.outcome})`}
                  </Typography>
                )}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<CopyIcon />} onClick={() => void navigator.clipboard?.writeText(markdown)}>
          Copy
        </Button>
        <Button size="small" startIcon={<DownloadIcon />} onClick={() => downloadText(fileName(sessionName), markdown)}>
          Download .md
        </Button>
      </Box>
    </Box>
  );
}

export interface SessionSummaryPanelProps {
  /** The session to summarize; `null` disables asking. */
  sessionId: string | null;
  /** Used for the downloaded file's name and the Markdown title. */
  sessionName?: string;
}

/**
 * "Summarize session" (issue #59): asks for a summary, which a background job writes, and shows it
 * when it is ready (polling every 3 s). Earlier summaries of the session are listed and can be reopened.
 */
export function SessionSummaryPanel({ sessionId, sessionName }: SessionSummaryPanelProps) {
  const { state, start, open } = useSessionSummary(sessionId);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [redactionMode, setRedactionMode] = useState<'standard' | 'strict'>('standard');

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    try {
      setHistory(await listSessionSummaries(sessionId));
    } catch {
      // The history is a convenience; the panel works without it.
    }
  }, [sessionId]);

  useEffect(() => {
    setHistory([]);
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (state.status === 'succeeded' || state.status === 'failed') void loadHistory();
  }, [state.status, loadHistory]);

  useEffect(() => {
    if (state.status !== 'consent') return;
    void getTerminalAiConsent()
      .then((consent) => setRedactionMode(consent.redactionMode))
      .catch(() => undefined);
  }, [state.status]);

  const acceptConsent = async () => {
    setConsentBusy(true);
    setConsentError(null);
    try {
      await acceptTerminalAiConsent();
      void start();
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : 'Could not record your choice');
    } finally {
      setConsentBusy(false);
    }
  };

  const busy = state.status === 'starting' || state.status === 'pending';
  const earlier = history.filter((h) => h.id !== state.summary?.id);

  return (
    <>
      <Typography variant="body2" color="text.secondary">
        Summarizes this session in the background and shows the result here when it is ready. Long sessions take a
        little while; you can leave this open.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={state.status === 'succeeded' || state.status === 'failed' ? <RefreshIcon /> : undefined}
          disabled={!sessionId || busy}
          onClick={() => void start()}
        >
          {state.status === 'succeeded' || state.status === 'failed' ? 'Summarize again' : 'Summarize'}
        </Button>
      </Box>
      {busy && (
        <>
          <LinearProgress aria-label="Summarizing" />
          <Typography variant="caption" color="text.secondary" aria-live="polite">
            Summarizing in the background…
          </Typography>
        </>
      )}
      {(state.status === 'failed' || state.status === 'error') && (
        <Alert severity="error">{errorText(state.errorCode, state.errorMessage)}</Alert>
      )}
      {state.status === 'succeeded' && state.summary && <SummaryResult summary={state.summary} sessionName={sessionName} />}
      {earlier.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="subtitle2">Earlier summaries</Typography>
          {earlier.map((item) => (
            <Button
              key={item.id}
              size="small"
              sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              onClick={() => open(item)}
            >
              {new Date(item.createdAt).toLocaleString()} ({item.status})
            </Button>
          ))}
        </Box>
      )}
      <TerminalAiConsentDialog
        open={state.status === 'consent'}
        redactionMode={redactionMode}
        busy={consentBusy}
        error={consentError}
        onAccept={acceptConsent}
        onCancel={() => void 0}
      />
    </>
  );
}
