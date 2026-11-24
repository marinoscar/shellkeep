/**
 * The Artifacts panel of a run (#63): the log archive each `collect_logs` step stored per server (Download), and the
 * zip bundle of the whole run: "Build bundle" while there is none, a progress line while it is built (the list is
 * polled), "Download bundle" once ready, and "Share link…" for the person who started the run. Downloads are
 * presigned URLs (15 minutes) opened in the browser and never logged.
 */
import { useState } from 'react';
import { Alert, Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import { getArtifactDownload } from '../api/runbooksApi';
import { useRunArtifacts } from '../hooks/useRunArtifacts';
import { errorMessage } from '../hooks/useAsync';
import { formatBytes, openDownload } from '../lib/openDownload';
import { RunLinkDialog } from './RunLinkDialog';

export interface ArtifactsPanelProps {
  runId: string;
  runbookName: string;
  /** The run has reached a final state: a bundle can be built. */
  finished: boolean;
  /** The viewer started the run and may create sharing links: shows "Share link…". */
  canShare: boolean;
}

export function ArtifactsPanel({ runId, runbookName, finished, canShare }: ArtifactsPanelProps) {
  const artifacts = useRunArtifacts(runId);
  const [shareOpen, setShareOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (artifactId: string) => {
    setDownloadError(null);
    try {
      const signed = await getArtifactDownload(runId, artifactId);
      openDownload(signed.url);
    } catch (err) {
      setDownloadError(errorMessage(err, 'The download could not be started'));
    }
  };

  const data = artifacts.data;
  const bundle = data?.bundle;
  const hasArchives = (data?.items.length ?? 0) > 0;

  return (
    <Box data-testid="artifacts-panel">
      {(artifacts.error || downloadError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {downloadError ?? artifacts.error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" component="h3" gutterBottom>
          Log bundle
        </Typography>
        {bundle?.status === 'ready' && bundle.artifactId ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <Typography variant="body2" sx={{ flexGrow: 1 }}>
              One zip with every archive, the step logs and a manifest.json
              {bundle.sizeBytes !== null ? ` (${formatBytes(bundle.sizeBytes)})` : ''}.
            </Typography>
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => void download(bundle.artifactId!)}>
              Download bundle
            </Button>
            {canShare && (
              <Button variant="outlined" startIcon={<ShareOutlinedIcon />} onClick={() => setShareOpen(true)}>
                Share link…
              </Button>
            )}
          </Stack>
        ) : bundle?.status === 'building' ? (
          <Box role="status" aria-live="polite">
            <Typography variant="body2" sx={{ mb: 1 }}>
              Building the bundle…
            </Typography>
            <LinearProgress aria-label="Building the bundle" />
          </Box>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              {finished
                ? 'No bundle yet. Build one zip of every archive and step log of this run.'
                : 'A bundle can be built once the run has finished.'}
            </Typography>
            <Button variant="contained" onClick={() => void artifacts.build()} disabled={!finished || artifacts.building}>
              Build bundle
            </Button>
          </Stack>
        )}
      </Paper>

      <Typography variant="subtitle1" component="h3" gutterBottom>
        Archives by server
      </Typography>
      {artifacts.loading && !data ? (
        <LinearProgress aria-label="Loading artifacts" />
      ) : !hasArchives ? (
        <Typography variant="body2" color="text.secondary">
          No logs were collected. Add a Collect logs step to a runbook to store the logs of each server here.
        </Typography>
      ) : (
        <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Archives by server">
          {data!.items.map((item) => (
            <Paper component="li" key={item.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {item.serverName ?? 'Server'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Step {item.stepId ?? item.stepIndex} · {item.fileCount} {item.fileCount === 1 ? 'file' : 'files'} ·{' '}
                    {formatBytes(item.sizeBytes)}
                  </Typography>
                </Box>
                <Button size="small" startIcon={<DownloadIcon />} onClick={() => void download(item.id)} aria-label={`Download the archive of ${item.serverName ?? 'the server'}`}>
                  Download
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {canShare && <RunLinkDialog open={shareOpen} onClose={() => setShareOpen(false)} runId={runId} title={runbookName} />}
    </Box>
  );
}
