/**
 * The key panel's Snippets tab (issue #172, epic #171): the user's saved terminal text.
 *
 * - A search box and a list. A tap INSERTS the snippet at the prompt (never Enter: the user presses it); a
 *   `{{name}}` blank asks for its value first.
 * - Add a snippet from the header; "Manage" switches the list to edit, delete and move up or down.
 * - After a save the API may say the text looks like a credential (`looks-like-secret`): the tab shows a
 *   warning until it is dismissed. The snippet is saved all the same.
 *
 * Text entry (the search box and the dialogs) raises the phone keyboard; `onTextEntry` tells the workspace, so it
 * does not read the keyboard coming back as "the user went back to the terminal" and close the panel.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as DownIcon,
  ArrowUpward as UpIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useSnippets } from '../../../../hooks/useSnippets';
import { extractPlaceholders } from '../../../../lib/terminal/snippets/placeholders';
import type { SnippetInsertResult } from '../../../../lib/terminal/snippets/insert';
import { SNIPPET_LIMITS, type Snippet } from '../../../../services/snippets-api';
import { PlaceholderDialog } from './PlaceholderDialog';
import { SnippetEditorDialog } from './SnippetEditorDialog';

export interface SnippetsTabProps {
  /** Puts text at the terminal's prompt. `confirmed`: insert a multi-line text even without bracketed paste. */
  onInsert: (text: string, options?: { confirmed?: boolean }) => SnippetInsertResult;
  /** The tab is taking text input (the search box has focus or a dialog is open). */
  onTextEntry?: (active: boolean) => void;
}

const KEY_TARGET = 44;

function preview(body: string): string {
  const first = body.split('\n')[0];
  return body.includes('\n') ? `${first} (+${body.split('\n').length - 1} more)` : first;
}

export function SnippetsTab({ onInsert, onTextEntry }: SnippetsTabProps) {
  const { query, setQuery, items, loading, error, reload, create, update, remove, move } = useSnippets();
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Snippet | 'new' | null>(null);
  const [filling, setFilling] = useState<{ snippet: Snippet; names: string[] } | null>(null);
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Snippet | null>(null);
  const [warned, setWarned] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const dialogOpen = Boolean(editing || filling || confirmText !== null || deleting);
  const textEntry = searchFocused || dialogOpen;
  useEffect(() => {
    onTextEntry?.(textEntry);
  }, [textEntry, onTextEntry]);
  useEffect(() => () => onTextEntry?.(false), [onTextEntry]);

  const insert = (text: string, confirmed = false) => {
    const result = onInsert(text, { confirmed });
    if (result === 'needs-confirmation') setConfirmText(text);
    else if (result === 'unavailable') setNotice('There is no open terminal to insert into.');
    else setNotice(null);
  };

  const tap = (snippet: Snippet) => {
    const names = extractPlaceholders(snippet.body);
    if (names.length > 0) setFilling({ snippet, names });
    else insert(snippet.body);
  };

  const searching = query.trim() !== '';
  const atLimit = items.length >= SNIPPET_LIMITS.perUser && !searching;

  return (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <TextField
          type="search"
          size="small"
          fullWidth
          placeholder="Search snippets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          slotProps={{
            htmlInput: {
              'aria-label': 'Search snippets',
              maxLength: SNIPPET_LIMITS.query,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="New snippet">
          <span>
            <IconButton
              aria-label="New snippet"
              onClick={() => setEditing('new')}
              disabled={atLimit}
              sx={{ width: KEY_TARGET, height: KEY_TARGET }}
            >
              <AddIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          size="small"
          aria-pressed={managing}
          onClick={() => setManaging((m) => !m)}
          sx={{ minHeight: KEY_TARGET, minWidth: 'auto' }}
        >
          {managing ? 'Done' : 'Manage'}
        </Button>
      </Stack>

      {warned && (
        <Alert severity="warning" onClose={() => setWarned(null)} data-testid="snippet-secret-warning">
          “{warned}” looks like it contains a password, key or token. It was saved, but snippets are stored unencrypted and
          shown on every device you sign in on. Consider removing the secret.
        </Alert>
      )}
      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void reload()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {managing && searching && (
        <Typography variant="caption" color="text.secondary">
          Clear the search to change the order.
        </Typography>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && items.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} aria-label="Loading snippets" />
          </Box>
        ) : items.length === 0 && !error ? (
          <Stack spacing={1} sx={{ alignItems: "center", py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {searching ? 'No snippet matches.' : 'No snippets yet. Save a command once and insert it with a tap.'}
            </Typography>
            {!searching && (
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
                Add a snippet
              </Button>
            )}
          </Stack>
        ) : (
          <List dense disablePadding aria-label="Snippets">
            {items.map((snippet, index) => (
              <ListItem
                key={snippet.id}
                disablePadding
                divider
                secondaryAction={
                  managing ? (
                    <Stack direction="row">
                      <IconButton
                        aria-label={`Move ${snippet.title} up`}
                        disabled={searching || index === 0}
                        onClick={() => void move(snippet.id, -1)}
                        sx={{ width: KEY_TARGET, height: KEY_TARGET }}
                      >
                        <UpIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        aria-label={`Move ${snippet.title} down`}
                        disabled={searching || index === items.length - 1}
                        onClick={() => void move(snippet.id, 1)}
                        sx={{ width: KEY_TARGET, height: KEY_TARGET }}
                      >
                        <DownIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        aria-label={`Edit ${snippet.title}`}
                        onClick={() => setEditing(snippet)}
                        sx={{ width: KEY_TARGET, height: KEY_TARGET }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        aria-label={`Delete ${snippet.title}`}
                        onClick={() => setDeleting(snippet)}
                        sx={{ width: KEY_TARGET, height: KEY_TARGET }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : undefined
                }
              >
                <ListItemButton
                  disabled={managing}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => tap(snippet)}
                  aria-label={`Insert ${snippet.title}`}
                  sx={{ minHeight: KEY_TARGET, pr: managing ? 22 : 2, '&.Mui-disabled': { opacity: 1 } }}
                >
                  <ListItemText
                    primary={snippet.title}
                    secondary={
                      <>
                        <Box component="span" sx={{ display: 'block', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {preview(snippet.body)}
                        </Box>
                        {snippet.tags.length > 0 && (
                          <Box component="span" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                            {snippet.tags.map((tag) => (
                              <Chip key={tag} label={tag} size="small" component="span" />
                            ))}
                          </Box>
                        )}
                      </>
                    }
                    slotProps={{ primary: { noWrap: true }, secondary: { component: 'span' } }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {editing && (
        <SnippetEditorDialog
          snippet={editing === 'new' ? undefined : editing}
          onSave={(input) => (editing === 'new' ? create(input) : update(editing.id, input))}
          onDone={(saved) => {
            setEditing(null);
            if (saved?.warning) setWarned(saved.title);
            else if (saved) setWarned(null);
          }}
        />
      )}
      {filling && (
        <PlaceholderDialog
          title={filling.snippet.title}
          body={filling.snippet.body}
          names={filling.names}
          onCancel={() => setFilling(null)}
          onInsert={(text) => {
            setFilling(null);
            insert(text);
          }}
        />
      )}
      {confirmText !== null && (
        <Dialog open onClose={() => setConfirmText(null)} aria-labelledby="snippet-multiline-title">
          <DialogTitle id="snippet-multiline-title">Insert a multi-line snippet?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              The terminal is not in bracketed-paste mode, so each line is typed with its own Enter and the shell may run
              them as they arrive. Insert it anyway?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmText(null)}>Cancel</Button>
            <Button
              color="warning"
              onClick={() => {
                const text = confirmText;
                setConfirmText(null);
                insert(text, true);
              }}
            >
              Insert anyway
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} aria-labelledby="snippet-delete-title">
          <DialogTitle id="snippet-delete-title">Delete “{deleting.title}”?</DialogTitle>
          <DialogContent>
            <DialogContentText>The snippet is removed from every device.</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              color="error"
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                void remove(target.id).catch(() => setNotice('Could not delete the snippet.'));
              }}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
