import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { SNIPPET_LIMITS, type SavedSnippet, type Snippet, type SnippetInput } from '../../../../services/snippets-api';

export interface SnippetEditorDialogProps {
  /** The snippet being edited; omitted for a new one. */
  snippet?: Snippet;
  /** Saves; resolves with what the API answered (including the secret warning). */
  onSave: (input: SnippetInput) => Promise<SavedSnippet>;
  /** The editor closed after a save; `saved` carries the warning. */
  onDone: (saved: SavedSnippet | null) => void;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((tag) => tag.trim()).filter((tag) => tag !== ''))];
}

/** Create or edit one snippet: a title, the text and tags. The limits are the API's; it validates again. */
export function SnippetEditorDialog({ snippet, onSave, onDone }: SnippetEditorDialogProps) {
  const [title, setTitle] = useState(snippet?.title ?? '');
  const [body, setBody] = useState(snippet?.body ?? '');
  const [tags, setTags] = useState((snippet?.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bytes = byteLength(body);
  const tagList = parseTags(tags);
  const problem =
    title.trim() === ''
      ? 'Give the snippet a title'
      : body === ''
        ? 'The snippet is empty'
        : bytes > SNIPPET_LIMITS.bodyBytes
          ? `The text is over ${SNIPPET_LIMITS.bodyBytes} bytes`
          : tagList.length > SNIPPET_LIMITS.tags
            ? `At most ${SNIPPET_LIMITS.tags} tags`
            : tagList.some((tag) => tag.length > SNIPPET_LIMITS.tag)
              ? `A tag is at most ${SNIPPET_LIMITS.tag} characters`
              : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await onSave({ title: title.trim(), body, tags: tagList });
      onDone(saved);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the snippet');
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={() => onDone(null)} fullWidth maxWidth="sm" aria-labelledby="snippet-editor-title">
      <form onSubmit={submit}>
        <DialogTitle id="snippet-editor-title">{snippet ? 'Edit snippet' : 'New snippet'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              fullWidth
              size="small"
              slotProps={{ htmlInput: { maxLength: SNIPPET_LIMITS.title } }}
            />
            <TextField
              label="Text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              fullWidth
              multiline
              minRows={4}
              maxRows={10}
              size="small"
              error={bytes > SNIPPET_LIMITS.bodyBytes}
              helperText={`Inserted at the prompt, never run. Use {{name}} for a blank to fill in. ${bytes}/${SNIPPET_LIMITS.bodyBytes} bytes`}
              slotProps={{
                htmlInput: { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, style: { fontFamily: 'monospace' } },
              }}
            />
            <TextField
              label="Tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              fullWidth
              size="small"
              helperText="Comma separated, optional"
            />
            <Alert severity="info" variant="outlined">
              Snippets are stored unencrypted and shown on every device you sign in on. Do not save passwords or keys.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={Boolean(problem) || saving}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
