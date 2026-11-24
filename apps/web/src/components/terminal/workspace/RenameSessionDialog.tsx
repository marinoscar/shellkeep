import { useEffect, useState, type FormEvent } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';

export interface RenameSessionDialogProps {
  /** The current name; `null` closes the dialog. */
  name: string | null;
  onClose: () => void;
  /** Save the new name (`PATCH /api/sessions/:id`). */
  onSave: (name: string) => void;
}

/** Rename a session from a tab (double-click) or the phone overflow menu. */
export function RenameSessionDialog({ name, onClose, onSave }: RenameSessionDialogProps) {
  const [value, setValue] = useState(name ?? '');
  useEffect(() => {
    if (name !== null) setValue(name);
  }, [name]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
    onClose();
  };

  return (
    <Dialog open={name !== null} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>Rename session</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Session name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!value.trim()}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
