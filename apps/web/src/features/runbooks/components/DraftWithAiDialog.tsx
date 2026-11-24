/**
 * "Draft with AI" (issue #64): a prompt, a preview with the risk and the warnings, and "Load into builder".
 * The draft is never saved or run from here: loading puts it in the builder, where the person reviews and
 * saves it like any other edit.
 */
import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { draftRunbook } from '../api/runbooksApi';
import type { DraftResult } from '../api/types';
import { errorMessage } from '../hooks/useAsync';

export interface DraftWithAiDialogProps {
  open: boolean;
  onClose: () => void;
  onLoad: (draft: DraftResult) => void;
}

export function DraftWithAiDialog({ open, onClose, onLoad }: DraftWithAiDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      setDraft(await draftRunbook(prompt.trim()));
    } catch (err) {
      setError(errorMessage(err, 'The draft could not be made'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="draft-ai-title">
      <DialogTitle id="draft-ai-title">Draft with AI</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="What should the runbook do?"
            multiline
            minRows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 4000 } }}
            helperText="Never type a secret here. A draft is a starting point: nothing is saved or run until you do it yourself."
          />
          {error && <Alert severity="error">{error}</Alert>}
          {draft && (
            <Stack spacing={1} data-testid="draft-preview">
              <Typography variant="subtitle2">
                Draft: {draft.definition.steps.length} step(s)
                {draft.risk ? `, risk ${draft.risk.risk}${draft.risk.destructive ? ' (destructive)' : ''}` : ''}
              </Typography>
              <List dense disablePadding aria-label="Steps of the draft">
                {draft.definition.steps.map((step) => (
                  <ListItem key={step.id} disableGutters>
                    <ListItemText primary={step.name} secondary={step.kind} />
                  </ListItem>
                ))}
              </List>
              {draft.warnings.length > 0 && (
                <Alert severity="warning">
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {draft.warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`}>{w.message}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="outlined" disabled={busy || prompt.trim() === ''} onClick={() => void generate()}>
          {busy ? 'Drafting…' : draft ? 'Draft again' : 'Draft'}
        </Button>
        <Button variant="contained" disabled={!draft} onClick={() => draft && onLoad(draft)}>
          Load into builder
        </Button>
      </DialogActions>
    </Dialog>
  );
}
