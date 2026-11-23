/**
 * Settings, Terminal (`/settings/terminal`), issue #48.
 *
 * The terminal domain's card on the per-user settings hub
 * (`config/userSettingsSections.tsx`): the scroll-buttons switch and the key
 * shortcuts editor, on ONE `useTerminalSettings` (the packaged
 * `useUserSettings`), so both controls send the same row version. The chrome
 * (heading, spinner, error alert, snackbars) matches the packaged Profile and
 * Appearance pages. #80 redesigns the page.
 *
 * No permission gate: the API grants `user_settings:read|write` to every role.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Container,
  FormControlLabel,
  Snackbar,
  Switch,
  Typography,
} from '@mui/material';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { useTerminalSettings } from '../../../hooks/useTerminalSettings';
import type { KeyShortcut } from '../../../types/terminal';
import { KeyShortcutsSettings } from './KeyShortcutsSettings';

/** The page title and description; mirror the `Terminal` card. */
export const TERMINAL_SETTINGS_TITLE = 'Terminal';
export const TERMINAL_SETTINGS_DESCRIPTION =
  'Scroll buttons and the key shortcuts bar shown under the terminal on touch screens.';

export function TerminalSettingsPage() {
  const { terminal, isLoading, isSaving, error, updateTerminal } = useTerminalSettings();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const handleScrollButtonsChange = async (showScrollButtons: boolean) => {
    try {
      await updateTerminal({ showScrollButtons });
      setSuccessMessage(showScrollButtons ? 'Scroll buttons shown' : 'Scroll buttons hidden');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update scroll buttons');
    }
  };

  const handleShortcutsSave = async (keyShortcuts: KeyShortcut[]) => {
    // KeyShortcutsSettings shows its own error; let the rejection reach it.
    await updateTerminal({ keyShortcuts });
    setSuccessMessage('Key shortcuts saved');
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {TERMINAL_SETTINGS_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {TERMINAL_SETTINGS_DESCRIPTION}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {terminal && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Scroll buttons
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Press-and-hold buttons beside the terminal that scroll its history. You can
                  also toggle them from the terminal toolbar.
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={terminal.showScrollButtons}
                      onChange={(e) => void handleScrollButtonsChange(e.target.checked)}
                      disabled={isSaving}
                    />
                  }
                  label="Show scroll buttons"
                />
              </CardContent>
            </Card>

            <KeyShortcutsSettings
              shortcuts={terminal.keyShortcuts}
              onSave={handleShortcutsSave}
              isSaving={isSaving}
            />
          </Box>
        )}
      </Box>

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
        message={successMessage}
      />
      <Snackbar open={!!saveError} autoHideDuration={5000} onClose={() => setSaveError(null)}>
        <Alert severity="error" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default TerminalSettingsPage;
