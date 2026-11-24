/**
 * Admin settings, Files (`/admin/settings/files`), issue #153 (epic #151).
 *
 * The files domain's card on the admin hub (`config/adminSections.tsx`): the
 * `files` system-settings namespace, i.e. the size caps for viewing, downloading
 * and uploading server files over SFTP, the read timeout and the per-user rate
 * limits. Read and saved through the packaged `useSystemSettings` (PATCH with
 * the row version); a save sends only the `files` namespace.
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
import {
  BYTE_UNITS,
  COUNT_FIELDS,
  FILES_SYSTEM_BOUNDS,
  byteFieldError,
  countFieldError,
  orderingErrors,
  readFilesSystemSettings,
  splitBytes,
  toBytes,
} from '../../../lib/files/system-settings';
import type {
  ByteUnit,
  FilesByteField,
  FilesCountField,
  FilesSystemSettings,
  FilesSystemSettingsDocument,
} from '../../../lib/files/system-settings';

/** The page title and description; mirror the admin `Files` card. */
export const FILES_SYSTEM_SETTINGS_TITLE = 'Files';
export const FILES_SYSTEM_SETTINGS_DESCRIPTION =
  'Size limits and rate limits for opening and downloading server files.';

type ByteDraft = { amount: string; unit: ByteUnit };
type Draft = Record<FilesByteField, ByteDraft> & Record<FilesCountField, string>;

const SIZE_FIELDS: { key: FilesByteField; label: string; help: string }[] = [
  {
    key: 'fullViewMaxBytes',
    label: 'Full view limit',
    help: 'A file up to this size opens whole in the viewer; larger files are read a window of this size at a time.',
  },
  {
    key: 'pagedViewMaxBytes',
    label: 'Paged view limit',
    help: 'The largest file the text viewer opens page by page. Above it, a file can only be downloaded.',
  },
  {
    key: 'downloadMaxBytes',
    label: 'Download limit',
    help: 'The largest file a user can download.',
  },
  {
    key: 'uploadMaxBytes',
    label: 'Upload limit',
    help: 'The largest file a user can upload.',
  },
];

const LIMIT_FIELDS: { key: FilesCountField; label: string; help: string }[] = [
  {
    key: 'sftpTimeoutSeconds',
    label: 'SFTP read timeout (seconds)',
    help: 'A read gives up after this long; for a download, after this long without progress.',
  },
  {
    key: 'contentRequestsPerMinute',
    label: 'File views per minute, per user',
    help: 'How many times a minute one user can open or page through a file.',
  },
  {
    key: 'downloadsPerMinute',
    label: 'Downloads per minute, per user',
    help: 'How many downloads one user can start in a minute.',
  },
  {
    key: 'maxConcurrentDownloads',
    label: 'Concurrent downloads, per user',
    help: 'How many downloads one user can have running at once.',
  },
];

function toDraft(settings: FilesSystemSettings): Draft {
  return {
    fullViewMaxBytes: splitBytes(settings.fullViewMaxBytes),
    pagedViewMaxBytes: splitBytes(settings.pagedViewMaxBytes),
    downloadMaxBytes: splitBytes(settings.downloadMaxBytes),
    uploadMaxBytes: splitBytes(settings.uploadMaxBytes),
    sftpTimeoutSeconds: String(settings.sftpTimeoutSeconds),
    contentRequestsPerMinute: String(settings.contentRequestsPerMinute),
    downloadsPerMinute: String(settings.downloadsPerMinute),
    maxConcurrentDownloads: String(settings.maxConcurrentDownloads),
  };
}

/** The draft as the namespace; an invalid size becomes `NaN` (the form is then invalid and unsendable). */
function fromDraft(draft: Draft): FilesSystemSettings {
  const bytes = (key: FilesByteField) => toBytes(draft[key].amount, draft[key].unit) ?? NaN;
  return {
    fullViewMaxBytes: bytes('fullViewMaxBytes'),
    pagedViewMaxBytes: bytes('pagedViewMaxBytes'),
    downloadMaxBytes: bytes('downloadMaxBytes'),
    uploadMaxBytes: bytes('uploadMaxBytes'),
    sftpTimeoutSeconds: Number(draft.sftpTimeoutSeconds),
    contentRequestsPerMinute: Number(draft.contentRequestsPerMinute),
    downloadsPerMinute: Number(draft.downloadsPerMinute),
    maxConcurrentDownloads: Number(draft.maxConcurrentDownloads),
  };
}

export function FilesSystemSettingsPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('system_settings:write');
  const { settings, isLoading, error, isSaving, updateSettings } =
    useSystemSettings<FilesSystemSettingsDocument>();

  const current = useMemo(() => readFilesSystemSettings(settings), [settings]);
  const initial = useMemo(() => toDraft(current), [current]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  if (isLoading && !settings) {
    return <LoadingSpinner />;
  }

  const errors: Record<string, string | null> = {};
  for (const { key } of SIZE_FIELDS) {
    errors[key] = byteFieldError(key, draft[key].amount, draft[key].unit);
  }
  for (const key of COUNT_FIELDS) {
    errors[key] = countFieldError(key, draft[key]);
  }
  // The ordering rule only speaks once both sides of a pair are valid sizes.
  const ordering = orderingErrors(
    Object.fromEntries(
      SIZE_FIELDS.map(({ key }) => [
        key,
        errors[key] === null ? toBytes(draft[key].amount, draft[key].unit) : null,
      ]),
    ),
  );
  for (const [key, message] of Object.entries(ordering)) {
    errors[key] = message ?? null;
  }
  const invalid = Object.values(errors).some((message) => message !== null);
  const next = fromDraft(draft);
  const dirty = !invalid && JSON.stringify(next) !== JSON.stringify(current);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !canWrite) return;
    setSaveError(null);
    try {
      await updateSettings({ files: next });
      setSuccessMessage('Files settings saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save files settings');
    }
  };

  const disabled = !canWrite || isSaving;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {FILES_SYSTEM_SETTINGS_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {FILES_SYSTEM_SETTINGS_DESCRIPTION}
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
                  Size limits
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  The full view limit must not be larger than the paged view limit, and the paged
                  view limit must not be larger than the download limit.
                </Typography>
                <Stack spacing={2}>
                  {SIZE_FIELDS.map(({ key, label, help }) => (
                    <Stack key={key} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <TextField
                        id={`files-${key}`}
                        label={label}
                        type="number"
                        value={draft[key].amount}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [key]: { ...d[key], amount: e.target.value } }))
                        }
                        error={errors[key] !== null}
                        helperText={errors[key] ?? help}
                        disabled={disabled}
                        slotProps={{ htmlInput: { min: 1, step: 1 } }}
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                      <TextField
                        id={`files-${key}-unit`}
                        select
                        label={`${label} unit`}
                        value={draft[key].unit}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [key]: { ...d[key], unit: e.target.value as ByteUnit },
                          }))
                        }
                        disabled={disabled}
                        sx={{ width: 96, flexShrink: 0 }}
                      >
                        {BYTE_UNITS.map((unit) => (
                          <MenuItem key={unit} value={unit}>
                            {unit}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Timeouts and rate limits
                </Typography>
                <Stack spacing={2}>
                  {LIMIT_FIELDS.map(({ key, label, help }) => (
                    <TextField
                      key={key}
                      id={`files-${key}`}
                      label={label}
                      type="number"
                      value={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      error={errors[key] !== null}
                      helperText={errors[key] ?? help}
                      disabled={disabled}
                      slotProps={{
                        htmlInput: {
                          min: FILES_SYSTEM_BOUNDS[key].min,
                          max: FILES_SYSTEM_BOUNDS[key].max,
                          step: 1,
                        },
                      }}
                      fullWidth
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="contained" disabled={disabled || invalid || !dirty}>
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

export default FilesSystemSettingsPage;
