/**
 * What the public `/s#lnk_…` page shows for a `runbook_run` link (#63): the run's bundle metadata and a Download
 * button. The route is public and the link token travels in `x-link-token` only (never a URL, storage or log). The
 * presigned URL it answers is valid 15 minutes and is handed to the browser, never logged.
 */
import { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import type { LinkRendererProps } from '@marinoscar/platform-web/sharing/headless';
import type { PublicBundle } from '../api/types';
import { formatBytes, openDownload } from '../lib/openDownload';

/** The header of a link token (the sharing slice's `LINK_TOKEN_HEADER`). */
export const LINK_TOKEN_HEADER = 'x-link-token';

export function PublicRunBundle({ token, apiClient }: LinkRendererProps) {
  const [bundle, setBundle] = useState<PublicBundle | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<PublicBundle>('/public/runbook-runs/bundle', { headers: { [LINK_TOKEN_HEADER]: token } })
      .then((value) => !cancelled && setBundle(value))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [apiClient, token]);

  if (failed) {
    return <Alert severity="info">This link is not available.</Alert>;
  }
  if (!bundle) return <CircularProgress aria-label="Loading the shared logs" />;

  return (
    <Stack spacing={2} data-testid="public-run-bundle">
      <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
        {bundle.runbook}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Log bundle{bundle.finishedAt ? ` of the run that finished ${new Date(bundle.finishedAt).toLocaleString()}` : ''} (
        {formatBytes(bundle.sizeBytes)}). It holds each server&apos;s archive, the step logs and a manifest.json with a
        checksum of every file.
      </Typography>
      <div>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => openDownload(bundle.url)}>
          Download
        </Button>
      </div>
    </Stack>
  );
}
