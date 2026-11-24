import { useState, type FormEvent } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { fillPlaceholders } from '../../../../lib/terminal/snippets/placeholders';

export interface PlaceholderDialogProps {
  title: string;
  body: string;
  names: readonly string[];
  /** The snippet's text with the blanks filled. */
  onInsert: (text: string) => void;
  onCancel: () => void;
}

/** A small form for the `{{name}}` blanks of a snippet, shown before it is inserted. */
export function PlaceholderDialog({ title, body, names, onInsert, onCancel }: PlaceholderDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onInsert(fillPlaceholders(body, values));
  };

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs" aria-labelledby="snippet-fill-title">
      <form onSubmit={submit}>
        <DialogTitle id="snippet-fill-title">Fill in {title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {names.map((name, index) => (
              <TextField
                key={name}
                label={name}
                value={values[name] ?? ''}
                onChange={(e) => setValues((current) => ({ ...current, [name]: e.target.value }))}
                autoFocus={index === 0}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } }}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="contained">
            Insert
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
