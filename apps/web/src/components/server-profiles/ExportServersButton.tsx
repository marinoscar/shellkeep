import { useState } from 'react';
import { Button } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useExportSources } from '@marinoscar/platform-web/exports/headless';
import { ExportDialog } from '@marinoscar/platform-web/exports/ui';

/** The export source the Servers page presets (the API's `server-profiles` source, #68). */
export const SERVER_PROFILES_EXPORT_SOURCE_ID = 'server-profiles';

interface ExportServersButtonProps {
  /** Called when an export was queued, so the page can say where it will appear. */
  onCreated?: () => void;
}

/**
 * "Export" on the Servers page: opens the packaged `ExportDialog` preset to the `server-profiles` source.
 *
 * The API decides who may export (`servers:read`): the button is drawn only when `GET /api/exports/sources`
 * returns the source for the caller. An export never contains a password, a private key or a passphrase.
 */
export function ExportServersButton({ onCreated }: ExportServersButtonProps) {
  const { sources } = useExportSources();
  const [open, setOpen] = useState(false);

  if (!sources.some((source) => source.id === SERVER_PROFILES_EXPORT_SOURCE_ID)) return null;

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<FileDownloadOutlinedIcon />}
        onClick={() => setOpen(true)}
        sx={{ minHeight: 44 }}
      >
        Export
      </Button>
      <ExportDialog
        open={open}
        onClose={() => setOpen(false)}
        sources={sources}
        initialSourceId={SERVER_PROFILES_EXPORT_SOURCE_ID}
        onCreated={() => {
          setOpen(false);
          onCreated?.();
        }}
      />
    </>
  );
}
