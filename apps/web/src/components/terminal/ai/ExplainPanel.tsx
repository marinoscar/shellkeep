import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  LinearProgress,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandIcon } from '@mui/icons-material';
import { useTerminalExplain } from '../../../hooks/useTerminalExplain';
import { acceptTerminalAiConsent, getTerminalAiConsent } from '../../../services/terminal-api';
import type { ExplainFinding, ExplainRequest } from '../../../services/terminal-explain-api';
import { AI_ERROR_TEXT, CommandResultCard } from './CommandAssistPanel';
import { SafeMarkdown } from './SafeMarkdown';
import { TerminalAiConsentDialog } from './TerminalAiConsentDialog';

/** The most selected text one request carries (the API's limit). */
export const EXPLAIN_SELECTION_MAX = 16384;

/** What the page asks the panel to explain: a selection it already read, or the last error. */
export interface ExplainTrigger {
  /** Changes for every request, so the same mode can be asked twice. */
  id: number;
  mode: 'selection' | 'last_error';
  /** The pane the request is about; defaults to the active one. */
  sessionId?: string;
  /** The selected terminal text (mode `selection`). */
  selection?: string;
}

export interface ExplainPanelProps {
  sessionId: string | null;
  /** Type the suggested fix at the prompt without Enter (the shared #57 insert path). */
  onInsert: (command: string) => void;
  /** The terminal's current selection, or `''`. */
  getSelection: () => string;
  trigger?: ExplainTrigger | null;
  /** Called once the panel has taken `trigger`, so a later re-open does not run it again. */
  onTriggerHandled?: () => void;
}

type ExplainBody = { mode: 'selection'; selection: string } | { mode: 'last_error' };

const redactedCount = (findings: ExplainFinding[]): number => findings.reduce((n, f) => n + f.count, 0);

/** "Explain": the selected output or the last error, what will be sent, the answer and a fix (issue #58). */
export function ExplainPanel({ sessionId, onInsert, getSelection, trigger = null, onTriggerHandled }: ExplainPanelProps) {
  const { state, begin, send, showPreview, retry, cancel } = useTerminalExplain(sessionId);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [redactionMode, setRedactionMode] = useState<'standard' | 'strict'>('standard');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const handled = useRef(0);

  const start = (request: ExplainBody, targetId: string | null = sessionId) => {
    if (!targetId) return;
    setHint(null);
    // A selection previews first, expanded; the last error is sent at once, preview on demand.
    setPreviewOpen(request.mode === 'selection');
    void begin({ ...request, sessionId: targetId } as ExplainRequest);
  };

  useEffect(() => {
    if (!trigger || trigger.id === handled.current || !sessionId) return;
    handled.current = trigger.id;
    start(
      trigger.mode === 'selection' ? { mode: 'selection', selection: trigger.selection ?? '' } : { mode: 'last_error' },
      trigger.sessionId ?? sessionId,
    );
    onTriggerHandled?.();
    // `start` only reads props that are inputs of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, sessionId]);

  useEffect(() => {
    if (state.status !== 'consent') return;
    void getTerminalAiConsent()
      .then((consent) => setRedactionMode(consent.redactionMode))
      .catch(() => undefined);
  }, [state.status]);

  const explainSelection = () => {
    const selection = getSelection();
    if (selection.trim() === '') {
      setHint('Select some terminal text first, then ask again.');
      return;
    }
    start({ mode: 'selection', selection });
  };

  const acceptConsent = async () => {
    setConsentBusy(true);
    setConsentError(null);
    try {
      await acceptTerminalAiConsent();
      retry();
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : 'Could not record your choice');
    } finally {
      setConsentBusy(false);
    }
  };

  const streaming = state.status === 'streaming';
  const suggested = state.result?.suggestedCommand;

  return (
    <>
      <Typography variant="body2" color="text.secondary">
        Explains the text selected in the terminal, or the last error block when nothing is selected, and suggests a fix you
        insert yourself.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" size="small" disabled={!sessionId || streaming} onClick={explainSelection}>
          Explain selection
        </Button>
        <Button variant="outlined" size="small" disabled={!sessionId || streaming} onClick={() => start({ mode: 'last_error' })}>
          Explain last error
        </Button>
        {streaming && (
          <Button size="small" onClick={cancel}>
            Stop
          </Button>
        )}
      </Box>
      {hint && (
        <Typography variant="caption" color="text.secondary" role="status">
          {hint}
        </Typography>
      )}

      {state.request && state.status !== 'consent' && (
        <Accordion
          disableGutters
          variant="outlined"
          expanded={previewOpen}
          onChange={(_e, open) => {
            setPreviewOpen(open);
            if (open && !state.preview && !state.previewLoading) showPreview();
          }}
        >
          <AccordionSummary expandIcon={<ExpandIcon />} aria-controls="explain-preview-body" id="explain-preview-header">
            <Typography variant="body2">What will be sent</Typography>
          </AccordionSummary>
          <AccordionDetails id="explain-preview-body" sx={{ display: 'grid', gap: 1 }}>
            {state.previewLoading && <LinearProgress aria-label="Loading preview" />}
            {state.preview && (
              <>
                <Box
                  component="pre"
                  aria-label="Redacted text to send"
                  data-testid="explain-preview-text"
                  sx={{ m: 0, p: 1, maxHeight: 200, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                >
                  {state.preview.text}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {redactedCount(state.preview.findings) > 0
                    ? `Redacted ${redactedCount(state.preview.findings)} item(s) before sending.`
                    : 'Nothing needed redacting.'}
                  {state.preview.truncated ? ' Older text was cut to fit.' : ''}
                </Typography>
              </>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      {state.status === 'preview' && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" size="small" disabled={!state.preview || state.previewLoading} onClick={() => void send()}>
            Send for explanation
          </Button>
          <Button size="small" onClick={cancel}>
            Cancel
          </Button>
        </Box>
      )}

      {streaming && <LinearProgress aria-label="Generating" />}
      {streaming && state.streamed && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }} aria-live="polite">
          {state.streamed}
        </Typography>
      )}
      {state.status === 'error' && (
        <Alert severity="error">
          {(state.errorCode && AI_ERROR_TEXT[state.errorCode]) || state.errorMessage || 'The assistant could not answer.'}
        </Alert>
      )}
      {state.result && (
        <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="explain-result">
          <SafeMarkdown markdown={state.result.markdown} />
          {suggested && (
            <CommandResultCard
              result={{ command: suggested.command, explanation: '', risk: suggested.risk, destructive: suggested.destructive, reasons: suggested.reasons }}
              onInsert={onInsert}
            />
          )}
        </Box>
      )}
      <TerminalAiConsentDialog
        open={state.status === 'consent'}
        redactionMode={redactionMode}
        busy={consentBusy}
        error={consentError}
        onAccept={acceptConsent}
        onCancel={cancel}
      />
    </>
  );
}
