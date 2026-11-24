/**
 * One server's step output (issue #65, Subtask D): a read-only xterm, so remote output is drawn
 * ANSI-faithfully and never through `innerHTML` (no HTML injection from a server). The history
 * comes from `GET .../steps/:stepIndex/log` (redacted); live chunks come from the run stream
 * through `onChunk` and pass through a `LogBuffer` (strict `seq` order, replays dropped).
 *
 * The seam: chunks that arrive while the history is loading may already be in it. Those whose
 * text the history's tail contains are dropped, and the buffer continues after them.
 *
 * Toolbar: Follow, search (`@xterm/addon-search`), Download, Copy, and "Open session on this
 * server" (`POST /api/sessions`, then the terminal), shown with `sessions:write` only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  Drawer,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import TerminalIcon from '@mui/icons-material/Terminal';
import { useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { createSession } from '../../../services/terminal-api';
import { resolveTerminalTheme } from '../../../lib/terminal/appearance';
import { getStepLog } from '../api/runbooksApi';
import type { RunChunkEvent, RunTargetRow } from '../api/types';
import { errorMessage } from '../hooks/useAsync';
import { LogBuffer } from '../lib/logBuffer';
import { formatDuration } from '../lib/format';
import { StatusChip } from './StatusChip';

/** How long a gap in `seq` is waited for before the held chunks are written anyway. */
export const GAP_FLUSH_MS = 1500;

/** xterm wants CRLF line ends. */
export const toTerminalText = (text: string): string => text.replace(/\r?\n/g, '\r\n');

export interface LogDrawerProps {
  open: boolean;
  onClose: () => void;
  runId: string;
  target: RunTargetRow | null;
  stepIndex: number;
  onStepChange: (stepIndex: number) => void;
  onChunk: (listener: (chunk: RunChunkEvent) => void) => () => void;
  /** Phone: a full-screen sheet instead of a side drawer. */
  fullScreen?: boolean;
}

export function LogDrawer({ open, onClose, runId, target, stepIndex, onStepChange, onChunk, fullScreen = false }: LogDrawerProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const textRef = useRef('');
  const followRef = useRef(true);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);

  const setHost = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el;
    setHostEl(el);
  }, []);

  // The terminal lives as long as its host element.
  useEffect(() => {
    if (!hostEl) return undefined;
    const term = new Terminal({
      disableStdin: true,
      convertEol: false,
      cursorBlink: false,
      scrollback: 20_000,
      fontSize: 13,
      theme: resolveTerminalTheme('follow-app', theme.palette.mode === 'dark' ? 'dark' : 'light'),
    });
    const search = new SearchAddon();
    const fit = new FitAddon();
    term.loadAddon(search);
    term.loadAddon(fit);
    term.open(hostEl);
    try {
      fit.fit();
    } catch {
      // No layout (a hidden drawer, a test): the default size stands.
    }
    termRef.current = term;
    searchRef.current = search;
    fitRef.current = fit;
    return () => {
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
      fitRef.current = null;
    };
  }, [hostEl, theme.palette.mode]);

  const write = useCallback((text: string) => {
    if (!text) return;
    textRef.current += text;
    termRef.current?.write(toTerminalText(text));
    if (followRef.current) termRef.current?.scrollToBottom?.();
  }, []);

  // History, then the live tail, for the chosen step.
  const targetId = target?.id;
  useEffect(() => {
    if (!open || !targetId || !hostEl) return undefined;
    let cancelled = false;
    let gapTimer: ReturnType<typeof setTimeout> | null = null;
    let buffer: LogBuffer | null = null;
    const early: RunChunkEvent[] = [];
    termRef.current?.reset?.();
    textRef.current = '';
    setError(null);

    const accept = (chunk: RunChunkEvent) => {
      if (!buffer) return;
      for (const data of buffer.push(chunk)) write(data);
      if (buffer.held > 0 && !gapTimer) {
        gapTimer = setTimeout(() => {
          gapTimer = null;
          if (buffer) for (const data of buffer.flush()) write(data);
        }, GAP_FLUSH_MS);
      }
    };

    const unsubscribe = onChunk((chunk) => {
      if (chunk.targetId !== targetId || chunk.stepIndex !== stepIndex) return;
      if (buffer) accept(chunk);
      else early.push(chunk);
    });

    const start = (history: string) => {
      if (cancelled) return;
      write(history);
      const tail = history.slice(-65_536);
      early.sort((a, b) => a.seq - b.seq);
      let next: number | null = null;
      const fresh: RunChunkEvent[] = [];
      for (const chunk of early) {
        if (history && tail.includes(chunk.data)) next = chunk.seq + 1;
        else fresh.push(chunk);
      }
      buffer = new LogBuffer(next ?? fresh[0]?.seq ?? null);
      for (const chunk of fresh) accept(chunk);
    };

    getStepLog(runId, targetId, stepIndex)
      .then(start)
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Could not load the log'));
        start('');
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (gapTimer) clearTimeout(gapTimer);
    };
  }, [open, runId, targetId, stepIndex, onChunk, write, hostEl]);

  const toggleFollow = (next: boolean) => {
    followRef.current = next;
    setFollow(next);
    if (next) termRef.current?.scrollToBottom?.();
  };

  const download = async () => {
    if (!target) return;
    try {
      const text = await getStepLog(runId, target.id, stepIndex);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${target.serverName}-step-${stepIndex + 1}.log`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, 'Could not download the log'));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textRef.current);
    } catch {
      setError('Copying is not allowed here');
    }
  };

  const openSession = async () => {
    if (!target?.serverProfileId) return;
    setOpening(true);
    try {
      const session = await createSession({ serverProfileId: target.serverProfileId, name: `${target.serverName} (runbook)` });
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not open a session'));
    } finally {
      setOpening(false);
    }
  };

  const step = target?.steps.find((s) => s.stepIndex === stepIndex);
  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }} role="region" aria-label="Step log">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 2, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2" noWrap>
            {target?.serverName ?? 'Log'}
          </Typography>
          {step && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusChip status={step.status} />
              {step.durationMs !== null && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {formatDuration(step.durationMs)}
                </Typography>
              )}
              {step.exitCode !== null && step.exitCode !== 0 && (
                <Typography variant="caption" sx={{ color: 'error.main' }}>
                  exit {step.exitCode}
                </Typography>
              )}
            </Box>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Close log">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ px: 2, pb: 1, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        {target && (
          <TextField
            select
            size="small"
            label="Step"
            value={stepIndex}
            onChange={(e) => onStepChange(Number(e.target.value))}
            sx={{ minWidth: 180, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}
          >
            {target.steps.map((s) => (
              <MenuItem key={s.stepIndex} value={s.stepIndex}>
                {s.stepIndex + 1}. {s.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          size="small"
          label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') searchRef.current?.findNext(query);
          }}
          sx={{ flex: '1 1 140px', minWidth: 0 }}
        />
        <Tooltip title="Previous match">
          <IconButton aria-label="Previous match" onClick={() => searchRef.current?.findPrevious(query)} disabled={!query}>
            <KeyboardArrowUpIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Next match">
          <IconButton aria-label="Next match" onClick={() => searchRef.current?.findNext(query)} disabled={!query}>
            <KeyboardArrowDownIcon />
          </IconButton>
        </Tooltip>
        <FormControlLabel control={<Switch checked={follow} onChange={(e) => toggleFollow(e.target.checked)} />} label="Follow" />
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Box
        ref={setHost}
        data-testid="log-terminal"
        sx={{ flex: 1, minHeight: 240, mx: 2, borderRadius: 1, overflow: 'hidden', bgcolor: 'background.default', border: 1, borderColor: 'divider' }}
      />
      <Stack direction="row" spacing={1} sx={{ p: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <Button startIcon={<DownloadIcon />} onClick={() => void download()}>
          Download log
        </Button>
        <Button startIcon={<ContentCopyIcon />} onClick={() => void copy()}>
          Copy
        </Button>
        {hasPermission('sessions:write') && target?.serverProfileId && (
          <Button startIcon={<TerminalIcon />} onClick={() => void openSession()} disabled={opening}>
            Open session on this server
          </Button>
        )}
      </Stack>
    </Box>
  );

  if (fullScreen) {
    return (
      <Dialog open={open} onClose={onClose} fullScreen aria-label="Step log">
        {content}
      </Dialog>
    );
  }
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', md: 760 }, maxWidth: '100%' } } }}>
      {content}
    </Drawer>
  );
}
