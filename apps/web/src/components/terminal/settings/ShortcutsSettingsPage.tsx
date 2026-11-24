/**
 * Settings, Keyboard shortcuts (`/settings/shortcuts`), issue #80.
 *
 * The terminal domain's second card on the per-user settings hub
 * (`config/userSettingsSections.tsx`): the key bar's shortcuts, stored in the
 * `shortcuts` user-settings namespace (at most 50). The editor shows the bytes
 * each shortcut sends (`encodeShortcut`, the encoder the key bar uses) and can
 * restore the built-in list. A user whose list is still stored at the pre-#80
 * `terminal.keyShortcuts` sees it here unchanged (`resolveKeyShortcuts`).
 *
 * No permission gate: the API grants `user_settings:read|write` to every role.
 * Shortcut sequences are user data: nothing here logs them.
 */

import { useState } from 'react';
import { Alert, Box, Container, Snackbar, Typography } from '@mui/material';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { useTerminalSettings } from '../../../hooks/useTerminalSettings';
import { DEFAULT_KEY_SHORTCUTS } from '../../../lib/terminal/settings';
import type { KeyShortcut } from '../../../types/terminal';
import { KeyShortcutsSettings } from './shortcuts/KeyShortcutsSettings';

/** The page title and description; mirror the `Keyboard shortcuts` card. */
export const SHORTCUTS_SETTINGS_TITLE = 'Keyboard shortcuts';
export const SHORTCUTS_SETTINGS_DESCRIPTION =
  'The keys on the bar under the terminal: their labels, keystrokes and the bytes they send.';

export function ShortcutsSettingsPage() {
  const { keyShortcuts, isLoading, isSaving, error, updateShortcuts } = useTerminalSettings();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const handleSave = async (list: KeyShortcut[]) => {
    // KeyShortcutsSettings shows its own error; let the rejection reach it.
    await updateShortcuts(list);
    setSuccessMessage('Key shortcuts saved');
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {SHORTCUTS_SETTINGS_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {SHORTCUTS_SETTINGS_DESCRIPTION}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {keyShortcuts && (
          <KeyShortcutsSettings
            shortcuts={keyShortcuts}
            defaults={DEFAULT_KEY_SHORTCUTS}
            onSave={handleSave}
            isSaving={isSaving}
          />
        )}
      </Box>

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
        message={successMessage}
      />
    </Container>
  );
}

export default ShortcutsSettingsPage;
