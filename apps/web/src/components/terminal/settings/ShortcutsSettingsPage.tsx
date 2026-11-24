/**
 * Settings, Keyboard shortcuts (`/settings/shortcuts`), issues #80 and #169.
 *
 * The terminal domain's second card on the per-user settings hub
 * (`config/userSettingsSections.tsx`): the editor of the v2 key layout (epic
 * #171) behind the accessory row and the key panel. A live preview of the row
 * (the real `TerminalKeyShortcutsBar`, sending nothing), the groups with
 * their keys (move, add from the catalog, custom keys, macros, span, delete),
 * the options (auto-hide with a hardware keyboard, haptics) and a reset to
 * the defaults behind a confirmation.
 *
 * Changes save themselves like the Terminal page's: debounced, one write at a
 * time, `PATCH /api/user-settings` with only `shortcuts.layout` and/or
 * `shortcuts.options` (`useTerminalSettings().updateKeys`); the v1
 * `keyShortcuts` list is never written from here (#169). An open terminal
 * picks the change up from the same settings source. A layout that breaks a
 * cap of the API is not sent; its problems are listed instead.
 *
 * No permission gate: the API grants `user_settings:read|write` to every role.
 * Key sequences are user data: nothing here logs them.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { RestartAlt as ResetIcon } from '@mui/icons-material';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { useTerminalSettings } from '../../../hooks/useTerminalSettings';
import {
  DEFAULT_KEY_LAYOUT,
  DEFAULT_KEY_OPTIONS,
  entrySpan,
  GRID_COLUMNS,
  type KeyLayout,
  type KeyOptions,
  type LayoutEntry,
} from '../../../lib/terminal/keys/keyModel';
import { addEntry, groupCells, validateKeyLayout } from '../../../lib/terminal/keys/layoutEdit';
import { KeyRowPreview } from './shortcuts/KeyRowPreview';
import { KeyLayoutEditor } from './shortcuts/KeyLayoutEditor';
import { AddKeyDialog } from './shortcuts/AddKeyDialog';

/** The page title and description; mirror the `Keyboard shortcuts` card. */
export const SHORTCUTS_SETTINGS_TITLE = 'Keyboard shortcuts';
export const SHORTCUTS_SETTINGS_DESCRIPTION =
  'The keys on the row above the phone keyboard and in the key panel: their groups, order, custom keys and macros.';

/** How long the page waits after the last change before it saves (the Terminal page's delay). */
export const SHORTCUTS_SETTINGS_SAVE_DELAY_MS = 400;

interface PendingKeys {
  layout?: KeyLayout;
  options?: KeyOptions;
}

const cloneLayout = (layout: KeyLayout): KeyLayout => JSON.parse(JSON.stringify(layout)) as KeyLayout;

export function ShortcutsSettingsPage() {
  const { keyLayout, keyOptions, isLoading, isSaving, error, updateKeys } = useTerminalSettings();
  // Edits not saved yet, shown over the stored layout and options.
  const [pending, setPending] = useState<PendingKeys>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<number | 'new' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const layout = pending.layout ?? keyLayout;
  const options = pending.options ?? keyOptions;
  const problems = useMemo(() => (layout ? validateKeyLayout(layout) : []), [layout]);

  // Autosave: once the edits settle, one write at a time. An invalid layout stays local.
  useEffect(() => {
    if (isSaving) return;
    const change: PendingKeys = {};
    if (pending.layout && problems.length === 0) change.layout = pending.layout;
    if (pending.options) change.options = pending.options;
    if (!change.layout && !change.options) return;
    const timer = setTimeout(() => {
      updateKeys(change)
        .then(() => {
          setSaveError(null);
          // Keep the edits made while this write was in flight.
          setPending((current) => ({
            ...(current.layout && current.layout !== change.layout ? { layout: current.layout } : {}),
            ...(current.options && current.options !== change.options ? { options: current.options } : {}),
          }));
        })
        .catch((err: unknown) => {
          setPending({});
          setSaveError(err instanceof Error ? err.message : 'Failed to save the keys');
        });
    }, SHORTCUTS_SETTINGS_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, problems, isSaving, updateKeys]);

  if (isLoading || !layout || !options) {
    return <LoadingSpinner />;
  }

  const setLayout = (next: KeyLayout) => setPending((current) => ({ ...current, layout: next }));
  const setOptions = (next: KeyOptions) => setPending((current) => ({ ...current, options: next }));

  /** Adds a picked key; a two-cell key that does not fit is added one cell wide when that fits. */
  const handleAdd = (entry: LayoutEntry): string | null => {
    if (addTarget === null) return 'No group chosen.';
    let result = addEntry(layout, addTarget, entry);
    if (!result.ok && addTarget !== 'new' && entrySpan(entry) === 2 && 'key' in entry) {
      const group = layout.groups[addTarget];
      if (group && groupCells(group) < GRID_COLUMNS) result = addEntry(layout, addTarget, { ...entry, span: 1 });
    }
    if (!result.ok) return result.error;
    setLayout(result.layout);
    return null;
  };

  const dirty = pending.layout !== undefined || pending.options !== undefined || isSaving;
  let status = 'Changes are saved automatically.';
  if (problems.length > 0) status = 'Not saved: fix the problems below.';
  else if (dirty) status = 'Saving…';

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {SHORTCUTS_SETTINGS_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {SHORTCUTS_SETTINGS_DESCRIPTION}
        </Typography>
        <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 2, minHeight: 20 }}>
          {status}
        </Typography>

        {(saveError ?? error) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {saveError ?? error}
          </Alert>
        )}

        <Stack spacing={3}>
          <KeyRowPreview layout={layout} />

          {problems.length > 0 && (
            <Alert severity="error" role="alert">
              <Typography variant="body2" gutterBottom>
                This layout cannot be saved:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </Box>
            </Alert>
          )}

          <Box component="section" aria-labelledby="key-groups-heading">
            <Typography id="key-groups-heading" variant="h6" component="h2" gutterBottom>
              Key groups
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The row shows the groups in this order; the key panel shows one group per row. A group holds up to
              four keys in four cells; a wide key takes two. Select a key to move, widen or delete it.
            </Typography>
            <KeyLayoutEditor
              layout={layout}
              onChange={setLayout}
              onAddKey={(group) => setAddTarget(group)}
              onAddGroup={() => setAddTarget('new')}
            />
          </Box>

          <Card component="section" aria-labelledby="key-options-heading">
            <CardContent>
              <Typography id="key-options-heading" variant="h6" component="h2" gutterBottom>
                Options
              </Typography>
              <Stack spacing={1}>
                <FormControlLabel
                  sx={{ minHeight: 44 }}
                  control={
                    <Switch
                      checked={options.autoHideWithHardwareKeyboard}
                      onChange={(e) => setOptions({ ...options, autoHideWithHardwareKeyboard: e.target.checked })}
                    />
                  }
                  label="Hide the key row while a hardware keyboard is in use"
                />
                <FormControlLabel
                  sx={{ minHeight: 44 }}
                  control={
                    <Switch checked={options.haptics} onChange={(e) => setOptions({ ...options, haptics: e.target.checked })} />
                  }
                  label="Vibrate briefly on key presses (where supported)"
                />
              </Stack>
            </CardContent>
          </Card>

          <Box>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<ResetIcon />}
              onClick={() => setConfirmReset(true)}
              sx={{ minHeight: 44 }}
            >
              Reset to defaults
            </Button>
          </Box>
        </Stack>
      </Box>

      {addTarget !== null && (
        <AddKeyDialog
          open
          target={addTarget}
          layout={layout}
          onAdd={handleAdd}
          onClose={() => setAddTarget(null)}
        />
      )}

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} aria-labelledby="reset-keys-title">
        <DialogTitle id="reset-keys-title">Reset the keys to the defaults?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your groups, custom keys and macros are replaced by the default layout, and both options are turned
            on. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmReset(false)} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            sx={{ minHeight: 44 }}
            onClick={() => {
              setConfirmReset(false);
              setPending({ layout: cloneLayout(DEFAULT_KEY_LAYOUT), options: { ...DEFAULT_KEY_OPTIONS } });
            }}
          >
            Reset
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default ShortcutsSettingsPage;
