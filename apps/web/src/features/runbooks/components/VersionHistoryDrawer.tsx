/**
 * The version history of a runbook (issue #65): every version, newest first, with a read-only
 * view of one and a JSON diff between two. Versions are immutable; nothing here changes one.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { getVersion, listVersions } from '../api/runbooksApi';
import type { RunbookVersionSummary } from '../api/types';
import { errorMessage } from '../hooks/useAsync';
import { diffLines, prettyJson, type DiffLine } from '../lib/jsonDiff';

export interface VersionHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  runbookId: string;
}

const LINE_SX: Record<DiffLine['kind'], object> = {
  same: { color: 'text.secondary' },
  added: { bgcolor: 'success.main', color: 'success.contrastText' },
  removed: { bgcolor: 'error.main', color: 'error.contrastText' },
};
const LINE_MARK: Record<DiffLine['kind'], string> = { same: '  ', added: '+ ', removed: '- ' };

export function VersionHistoryDrawer({ open, onClose, runbookId }: VersionHistoryDrawerProps) {
  const [versions, setVersions] = useState<RunbookVersionSummary[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [body, setBody] = useState<{ title: string; lines: DiffLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setBody(null);
    listVersions(runbookId)
      .then((page) => setVersions(page.items))
      .catch((err) => setError(errorMessage(err, 'Could not load the versions')));
  }, [open, runbookId]);

  useEffect(() => {
    if (picked.length === 0) {
      setBody(null);
      return;
    }
    let cancelled = false;
    const sorted = [...picked].sort((x, y) => x - y);
    Promise.all(sorted.map((v) => getVersion(runbookId, v)))
      .then((views) => {
        if (cancelled) return;
        if (views.length === 1) {
          setBody({ title: `Version ${views[0]!.version}`, lines: prettyJson(views[0]!.definition).split('\n').map((text) => ({ kind: 'same', text })) });
        } else {
          setBody({
            title: `Changes from v${views[0]!.version} to v${views[1]!.version}`,
            lines: diffLines(prettyJson(views[0]!.definition), prettyJson(views[1]!.definition)),
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, 'Could not load the version'));
      });
    return () => {
      cancelled = true;
    };
  }, [picked, runbookId]);

  const toggle = (version: number) =>
    setPicked((current) =>
      current.includes(version) ? current.filter((v) => v !== version) : [...current, version].slice(-2),
    );

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', md: 720 }, maxWidth: '100%' } } }}>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }} role="region" aria-label="Version history">
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
            Version history
          </Typography>
          <IconButton onClick={onClose} aria-label="Close version history">
            <CloseIcon />
          </IconButton>
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          Tick one version to read it, two to compare them.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <List dense sx={{ maxHeight: 240, overflow: 'auto', flexShrink: 0 }}>
          {versions.map((v) => (
            <ListItem key={v.version} disablePadding>
              <ListItemButton onClick={() => toggle(v.version)}>
                <ListItemIcon>
                  <Checkbox edge="start" checked={picked.includes(v.version)} tabIndex={-1} slotProps={{ input: { 'aria-label': `Version ${v.version}` } }} />
                </ListItemIcon>
                <ListItemText primary={`v${v.version}${v.changelog ? ` · ${v.changelog}` : ''}`} secondary={new Date(v.createdAt).toLocaleString()} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        {body && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="subtitle2" component="h3" sx={{ my: 1 }}>
              {body.title}
            </Typography>
            <Box component="pre" data-testid="version-body" sx={{ flex: 1, overflow: 'auto', m: 0, p: 1, fontFamily: 'monospace', fontSize: 12, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              {body.lines.map((line, index) => (
                <Box key={index} component="span" sx={{ display: 'block', whiteSpace: 'pre', ...LINE_SX[line.kind] }}>
                  {LINE_MARK[line.kind]}
                  {line.text}
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
