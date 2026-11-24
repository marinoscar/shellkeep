import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, LinearProgress, Switch, TextField, Typography } from '@mui/material';
import {
  ContentCopy as CopyIcon,
  KeyboardReturn as InsertIcon,
  Refresh as RegenerateIcon,
} from '@mui/icons-material';
import { useCommandAssist } from '../../../hooks/useCommandAssist';
import { acceptTerminalAiConsent, getTerminalAiConsent } from '../../../services/terminal-api';
import type { AssistResultFrame, CommandRisk } from '../../../services/terminal-assist-api';
import { TerminalAiConsentDialog } from './TerminalAiConsentDialog';
import { sanitizeForInsert } from './insertCommand';

export const ASSIST_PROMPT_MAX = 2000;

const RISK_LABEL: Record<CommandRisk, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
const RISK_COLOR: Record<CommandRisk, 'success' | 'warning' | 'error'> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

const ERROR_TEXT: Record<string, string> = {
  AI_ASSIST_UNPARSEABLE: "The answer could not be read as a single command. Try rephrasing, or regenerate.",
  AI_DISABLED: 'AI is turned off for this deployment.',
  AI_KEY_REQUIRED: 'Add your AI key in Settings to use the assistant.',
  AI_RATE_LIMITED: 'The AI provider is rate limiting requests. Try again shortly.',
};

/** The suggested command, its risk and what Insert does. Exported for tests. */
export function CommandResultCard({
  result,
  onInsert,
  onRegenerate,
}: {
  result: AssistResultFrame;
  onInsert: (command: string) => void;
  onRegenerate: () => void;
}) {
  const insertable = sanitizeForInsert(result.command) !== null;
  return (
    <Box sx={{ border: 1, borderColor: result.destructive ? 'error.main' : 'divider', borderRadius: 1, p: 1.5, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Suggested command
        </Typography>
        <Chip size="small" color={RISK_COLOR[result.risk]} label={RISK_LABEL[result.risk]} />
        {result.destructive && <Chip size="small" color="error" variant="filled" label="Destructive" />}
      </Box>
      <Box
        component="pre"
        aria-label="Suggested command"
        sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
      >
        {result.command}
      </Box>
      {result.explanation && <Typography variant="body2">{result.explanation}</Typography>}
      {result.reasons.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }} aria-label="Why this is risky">
          {result.reasons.map((reason) => (
            <Typography component="li" variant="caption" color={result.destructive ? 'error' : 'text.secondary'} key={reason}>
              {reason}
            </Typography>
          ))}
        </Box>
      )}
      {!insertable && (
        <Alert severity="warning" variant="outlined" sx={{ typography: 'caption' }}>
          This suggestion contains a control character, so it cannot be inserted. You can copy it.
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" size="small" startIcon={<InsertIcon />} disabled={!insertable} onClick={() => onInsert(result.command)}>
          Insert
        </Button>
        <Button size="small" startIcon={<CopyIcon />} onClick={() => void navigator.clipboard?.writeText(result.command)}>
          Copy
        </Button>
        <Button size="small" startIcon={<RegenerateIcon />} onClick={onRegenerate}>
          Regenerate
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Insert only types it at the prompt. You press Enter.
      </Typography>
    </Box>
  );
}

export interface CommandAssistPanelProps {
  /** The active session; `null` disables asking. */
  sessionId: string | null;
  /** Type the command at the focused pane's prompt, without Enter. */
  onInsert: (command: string) => void;
  /** Changes when the shortcut asks to focus the prompt. */
  focusRequest?: number;
}

/** "Suggest command": prompt, streamed explanation and a result card (issue #57). */
export function CommandAssistPanel({ sessionId, onInsert, focusRequest = 0 }: CommandAssistPanelProps) {
  const { state, ask, retry, cancel } = useCommandAssist(sessionId);
  const [prompt, setPrompt] = useState('');
  const [includeScreen, setIncludeScreen] = useState(true);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [redactionMode, setRedactionMode] = useState<'standard' | 'strict'>('standard');
  const input = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (state.status !== 'consent') return;
    void getTerminalAiConsent()
      .then((consent) => setRedactionMode(consent.redactionMode))
      .catch(() => undefined);
  }, [state.status]);

  const streaming = state.status === 'streaming';
  const submit = () => void ask(prompt, includeScreen);

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

  return (
    <>
      <TextField
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, ASSIST_PROMPT_MAX))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !streaming) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Describe what you want to do"
        size="small"
        multiline
        minRows={2}
        inputRef={input}
        slotProps={{ htmlInput: { 'aria-label': 'Describe a command', maxLength: ASSIST_PROMPT_MAX } }}
      />
      <FormControlLabel
        control={<Switch size="small" checked={includeScreen} onChange={(e) => setIncludeScreen(e.target.checked)} />}
        label={<Typography variant="caption">Include the last 40 screen lines (redacted)</Typography>}
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" size="small" disabled={!sessionId || prompt.trim() === '' || streaming} onClick={submit}>
          Suggest
        </Button>
        {streaming && (
          <Button size="small" onClick={cancel}>
            Stop
          </Button>
        )}
      </Box>
      {streaming && <LinearProgress aria-label="Generating" />}
      {state.context && (
        <Typography variant="caption" color="text.secondary" data-testid="assist-context">
          Sent: {state.context.os ?? 'unknown OS'}, {state.context.shell ?? 'unknown shell'}, {state.context.cwd ?? 'unknown directory'}
          {state.context.screenLines > 0 ? `, ${state.context.screenLines} screen lines` : ', no screen text'}
          {state.context.findings.length > 0
            ? `; redacted ${state.context.findings.reduce((n, f) => n + f.count, 0)} item(s)`
            : ''}
        </Typography>
      )}
      {streaming && state.streamed && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} aria-live="polite">
          {state.streamed}
        </Typography>
      )}
      {state.status === 'error' && (
        <Alert severity="error">
          {(state.errorCode && ERROR_TEXT[state.errorCode]) || state.errorMessage || 'The assistant could not answer.'}
        </Alert>
      )}
      {state.result && <CommandResultCard result={state.result} onInsert={onInsert} onRegenerate={retry} />}
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
