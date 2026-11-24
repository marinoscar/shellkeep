/**
 * The key panel's History tab (issue #173, epic #171): the recent shell commands of this session's server.
 *
 * - A search box and a list, newest first. A tap INSERTS the command at the prompt (never Enter: the user
 *   presses it), with the same helper as snippets (multi-line confirmation included).
 * - "Save as snippet" on a row opens the snippet editor with the command in it.
 * - The API redacts secrets: a masked entry shows a chip and cannot be saved; entries that were entirely a
 *   secret are not listed (a count says so).
 * - bash writes its history when a shell exits, so the commands of a running shell may be missing. The hint
 *   says how to flush them (`history -a`) for the user to run; the web never types it for them.
 *
 * Text entry (the search box and dialogs) raises the phone keyboard; `onTextEntry` tells the workspace.
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
import { BookmarkAddOutlined as SaveIcon, Search as SearchIcon } from '@mui/icons-material';
import { useCommandHistory, type CommandHistoryProblem } from '../../../../hooks/useCommandHistory';
import type { SnippetInsertResult } from '../../../../lib/terminal/snippets/insert';
import { COMMAND_HISTORY_LIMITS } from '../../../../services/command-history-api';
import { createSnippet, type SavedSnippet, type SnippetInput } from '../../../../services/snippets-api';
import { SnippetEditorDialog } from '../snippets/SnippetEditorDialog';

export interface HistoryTabProps {
  sessionId: string;
  /** Puts text at the terminal's prompt. `confirmed`: insert a multi-line text even without bracketed paste. */
  onInsert: (text: string, options?: { confirmed?: boolean }) => SnippetInsertResult;
  /** The tab is taking text input (the search box has focus or a dialog is open). */
  onTextEntry?: (active: boolean) => void;
}

const KEY_TARGET = 44;

const PROBLEM_TEXT: Record<CommandHistoryProblem, string> = {
  'sftp-unavailable': 'History is read over SFTP, and this server does not offer it.',
  'rate-limited': 'Too many requests. Try again in a moment.',
  failed: 'Could not read the history from the server.',
};

export function HistoryTab({ sessionId, onInsert, onTextEntry }: HistoryTabProps) {
  const { query, setQuery, history, loading, problem, reload } = useCommandHistory(sessionId);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [warned, setWarned] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const textEntry = searchFocused || saving !== null || confirmText !== null;
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

  const searching = query.trim() !== '';
  const entries = history?.entries ?? [];

  return (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      <TextField
        type="search"
        size="small"
        fullWidth
        placeholder="Search history"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        slotProps={{
          htmlInput: {
            'aria-label': 'Search history',
            maxLength: COMMAND_HISTORY_LIMITS.query,
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

      {saved && (
        <Alert severity="success" onClose={() => setSaved(null)}>
          Saved “{saved}” to your snippets.
        </Alert>
      )}
      {warned && (
        <Alert severity="warning" onClose={() => setWarned(null)} data-testid="history-secret-warning">
          “{warned}” looks like it contains a password, key or token. It was saved, but snippets are stored unencrypted.
        </Alert>
      )}
      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {problem && (
        <Alert
          severity="error"
          action={
            problem === 'sftp-unavailable' ? undefined : (
              <Button color="inherit" size="small" onClick={() => void reload()}>
                Retry
              </Button>
            )
          }
        >
          {PROBLEM_TEXT[problem]}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && !history ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} aria-label="Loading history" />
          </Box>
        ) : entries.length === 0 && !problem ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            {searching
              ? 'No command matches.'
              : history?.shell === null
                ? 'No shell history file was found on this server yet.'
                : 'There are no commands in the history yet.'}
          </Typography>
        ) : (
          <List dense disablePadding aria-label="Command history">
            {entries.map((entry) => (
              <ListItem
                key={entry.command}
                disablePadding
                divider
                secondaryAction={
                  entry.masked ? undefined : (
                    <Tooltip title="Save as snippet">
                      <IconButton
                        aria-label={`Save as snippet: ${entry.command}`}
                        onClick={() => setSaving(entry.command)}
                        sx={{ width: KEY_TARGET, height: KEY_TARGET }}
                      >
                        <SaveIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )
                }
              >
                <ListItemButton
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(entry.command)}
                  aria-label={`Insert ${entry.command}`}
                  sx={{ minHeight: KEY_TARGET, pr: entry.masked ? 2 : 7 }}
                >
                  <ListItemText
                    primary={
                      <Box component="span" sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {entry.command.split('\n')[0]}
                        {entry.command.includes('\n') ? ' …' : ''}
                      </Box>
                    }
                    secondary={entry.masked ? <Chip label="secret masked" size="small" component="span" /> : undefined}
                    slotProps={{ secondary: { component: 'span' } }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" data-testid="history-lag-note">
        {history?.shell ? `From the ${history.shell} history file. ` : ''}
        History may lag until the shell exits; in bash, run <code>history -a</code> yourself to write it now.
        {history && history.dropped > 0 ? ` ${history.dropped} entries that looked like secrets are hidden.` : ''}
        {history?.truncated ? ' Older commands are not shown.' : ''}
      </Typography>

      {saving !== null && (
        <SnippetEditorDialog
          initialBody={saving}
          onSave={(input: SnippetInput): Promise<SavedSnippet> => createSnippet(input)}
          onDone={(result) => {
            setSaving(null);
            if (result?.warning) setWarned(result.title);
            else if (result) setSaved(result.title);
          }}
        />
      )}
      {confirmText !== null && (
        <Dialog open onClose={() => setConfirmText(null)} aria-labelledby="history-multiline-title">
          <DialogTitle id="history-multiline-title">Insert a multi-line command?</DialogTitle>
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
    </Stack>
  );
}
