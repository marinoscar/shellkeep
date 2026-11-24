import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

export interface TerminalAiConsentDialogProps {
  open: boolean;
  /** The user accepted: the caller records it (`acceptTerminalAiConsent`) and retries its request. */
  onAccept: () => void | Promise<void>;
  onCancel: () => void;
  /** `strict` also drops every line that had a redaction. Defaults to `standard`. */
  redactionMode?: 'standard' | 'strict';
  /** Disables the buttons while the acceptance is being recorded. */
  busy?: boolean;
  /** An error from recording the acceptance. */
  error?: string | null;
}

/**
 * The consent step before terminal output can reach an AI feature (issue #56). Used by the
 * suggest, explain and summarize actions (#57, #58, #59) when the API answers
 * `409 AI_CONSENT_REQUIRED`. It states what is sent, that redaction is best effort and
 * where the hard control is.
 */
export function TerminalAiConsentDialog({
  open,
  onAccept,
  onCancel,
  redactionMode = 'standard',
  busy = false,
  error = null,
}: TerminalAiConsentDialogProps) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth aria-labelledby="terminal-ai-consent-title">
      <DialogTitle id="terminal-ai-consent-title">Send terminal output to AI?</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 1.5, pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2">
            To help you, ShellKeep sends recent text from your terminal (or the part you select) to the AI provider whose
            key you use. It also sends the server's operating system, shell and current directory.
          </Typography>
          <Typography variant="body2">
            Before anything is sent, ShellKeep redacts what looks like a secret: access keys, tokens, private keys,
            passwords in URLs and <code>key=value</code> pairs, and long random strings.
            {redactionMode === 'strict' ? ' Your organization also drops every line that had a match.' : ''}
          </Typography>
          <Alert severity="warning" variant="outlined">
            Redaction is best effort, not a guarantee. A secret in an unusual format can get through. Do not use AI
            features while sensitive output is on screen.
          </Alert>
          <Typography variant="body2">
            To keep a server out of AI entirely, turn off <strong>Send terminal output to AI</strong> in that server's
            profile. Each request is recorded in the audit log with counts and sizes, never the text.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button variant="contained" onClick={() => void onAccept()} disabled={busy}>
          I understand, continue
        </Button>
      </DialogActions>
    </Dialog>
  );
}
