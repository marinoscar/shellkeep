/**
 * Admin settings, Terminal (`/admin/settings/terminal`), issue #46.
 *
 * The terminal domain's card on the admin hub (`config/adminSections.tsx`):
 * the `terminal` system-settings namespace, i.e. the session reaper's
 * thresholds and the server profile the Doctor's tmux probe uses. Read and
 * saved through the packaged `useSystemSettings` (PATCH with the row version).
 *
 * The card and the route gate on `system_settings:read` (what
 * `GET /api/system-settings` enforces); saving needs `system_settings:write`,
 * gated here by disabling the form.
 */

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSystemSettings } from '@marinoscar/platform-web/settings/headless';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { useServerProfiles } from '../../../hooks/useServerProfiles';
import {
  TERMINAL_SYSTEM_BOUNDS,
  readTerminalSystemSettings,
  thresholdError,
} from '../../../lib/terminal/system-settings';
import type {
  TerminalSystemSettings,
  TerminalSystemSettingsDocument,
  TerminalSystemThreshold,
} from '../../../lib/terminal/system-settings';

/** The page title and description; mirror the admin `Terminal` card. */
export const TERMINAL_SYSTEM_SETTINGS_TITLE = 'Terminal';
export const TERMINAL_SYSTEM_SETTINGS_DESCRIPTION =
  'When idle terminal sessions are detached, terminated and purged, and which server the Doctor probes.';

/** The value of the probe select that means "no profile". */
const NO_PROFILE = '';

type Draft = Record<TerminalSystemThreshold, string> & { doctorProbeProfileId: string };

const FIELDS: { key: TerminalSystemThreshold; label: string; unit: string; help: string }[] = [
  {
    key: 'detachAfterMinutes',
    label: 'Detach after',
    unit: 'minutes',
    help: 'A connected session with no browser attached for this long is marked detached.',
  },
  {
    key: 'terminateDetachedAfterHours',
    label: 'Terminate detached sessions after',
    unit: 'hours',
    help: 'A detached session is terminated (its tmux session ends) after this long.',
  },
  {
    key: 'purgeTerminatedAfterDays',
    label: 'Purge terminated sessions after',
    unit: 'days',
    help: 'A terminated session is removed from the session list after this long.',
  },
];

function toDraft(settings: TerminalSystemSettings): Draft {
  return {
    detachAfterMinutes: String(settings.detachAfterMinutes),
    terminateDetachedAfterHours: String(settings.terminateDetachedAfterHours),
    purgeTerminatedAfterDays: String(settings.purgeTerminatedAfterDays),
    doctorProbeProfileId: settings.doctorProbeProfileId ?? NO_PROFILE,
  };
}

export function TerminalSystemSettingsPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('system_settings:write');
  const { settings, isLoading, error, isSaving, updateSettings } =
    useSystemSettings<TerminalSystemSettingsDocument>();
  const { profiles, fetchProfiles } = useServerProfiles();

  const current = useMemo(() => readTerminalSystemSettings(settings), [settings]);
  const [draft, setDraft] = useState<Draft>(() => toDraft(current));
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(current));
  }, [current]);

  useEffect(() => {
    void fetchProfiles({ pageSize: 100 });
  }, [fetchProfiles]);

  if (isLoading && !settings) {
    return <LoadingSpinner />;
  }

  const errors = Object.fromEntries(
    FIELDS.map(({ key }) => [key, thresholdError(key, draft[key])]),
  ) as Record<TerminalSystemThreshold, string | null>;
  const invalid = FIELDS.some(({ key }) => errors[key] !== null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(current));
  // A stored profile id that is not among the viewer's profiles stays selectable.
  const probeIsUnknown =
    draft.doctorProbeProfileId !== NO_PROFILE &&
    !profiles.some((p) => p.id === draft.doctorProbeProfileId);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !canWrite) return;
    setSaveError(null);
    try {
      await updateSettings({
        terminal: {
          detachAfterMinutes: Number(draft.detachAfterMinutes),
          terminateDetachedAfterHours: Number(draft.terminateDetachedAfterHours),
          purgeTerminatedAfterDays: Number(draft.purgeTerminatedAfterDays),
          doctorProbeProfileId:
            draft.doctorProbeProfileId === NO_PROFILE ? null : draft.doctorProbeProfileId,
        },
      });
      setSuccessMessage('Terminal settings saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save terminal settings');
    }
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {TERMINAL_SYSTEM_SETTINGS_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {TERMINAL_SYSTEM_SETTINGS_DESCRIPTION}
          {!canWrite && ' (read-only)'}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Box component="form" noValidate onSubmit={(e) => void handleSubmit(e)}>
          <Stack spacing={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Session lifecycle
                </Typography>
                <Stack spacing={2}>
                  {FIELDS.map(({ key, label, unit, help }) => (
                    <TextField
                      key={key}
                      id={`terminal-${key}`}
                      label={`${label} (${unit})`}
                      type="number"
                      value={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      error={errors[key] !== null}
                      helperText={errors[key] ?? help}
                      disabled={!canWrite || isSaving}
                      slotProps={{
                        htmlInput: {
                          min: TERMINAL_SYSTEM_BOUNDS[key].min,
                          max: TERMINAL_SYSTEM_BOUNDS[key].max,
                          step: 1,
                        },
                      }}
                      fullWidth
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Doctor probe
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  The Doctor connects to this server profile and checks that tmux answers. With no
                  profile the check is skipped.
                </Typography>
                <TextField
                  id="terminal-doctorProbeProfileId"
                  select
                  label="Probe server profile"
                  value={draft.doctorProbeProfileId}
                  onChange={(e) => setDraft((d) => ({ ...d, doctorProbeProfileId: e.target.value }))}
                  disabled={!canWrite || isSaving}
                  fullWidth
                >
                  <MenuItem value={NO_PROFILE}>
                    <em>None (skip the probe)</em>
                  </MenuItem>
                  {profiles.map((profile) => (
                    <MenuItem key={profile.id} value={profile.id}>
                      {profile.name} ({profile.username}@{profile.hostname}:{profile.port})
                    </MenuItem>
                  ))}
                  {probeIsUnknown && (
                    <MenuItem value={draft.doctorProbeProfileId}>
                      A profile you do not own ({draft.doctorProbeProfileId})
                    </MenuItem>
                  )}
                </TextField>
              </CardContent>
            </Card>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="submit"
                variant="contained"
                disabled={!canWrite || isSaving || invalid || !dirty}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </Box>
          </Stack>
        </Box>

        <Snackbar
          open={!!successMessage}
          autoHideDuration={3000}
          onClose={() => setSuccessMessage(null)}
          message={successMessage}
        />
        <Snackbar open={!!saveError} autoHideDuration={6000} onClose={() => setSaveError(null)}>
          <Alert severity="error" onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        </Snackbar>
      </Box>
    </Container>
  );
}

export default TerminalSystemSettingsPage;
