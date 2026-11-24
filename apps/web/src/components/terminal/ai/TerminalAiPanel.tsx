import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoAwesomeOutlined as AssistantIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  KeyboardReturn as InsertIcon,
} from '@mui/icons-material';

/** The panel's three actions (#57, #58, #59). */
export type TerminalAiMode = 'suggest' | 'explain' | 'summarize';

/** The docked panel's width bounds in px (desktop). */
export const AI_PANEL_MIN_WIDTH = 320;
export const AI_PANEL_MAX_WIDTH = 480;
const AI_PANEL_DEFAULT_WIDTH = 360;

/** Shown under each action until its API ships (#57, #58, #59). */
export const AI_COMING_SOON = 'Coming with Terminal AI';

export interface TerminalAiPanelProps {
  open: boolean;
  onClose: () => void;
  /** `side`: docked right of the panes (`md` and up); `sheet`: a bottom drawer (phone, tablet). */
  variant: 'side' | 'sheet';
  /**
   * Type a command at the focused pane's prompt, never followed by Enter. The
   * page implements it with `insertSuggestedCommand`.
   */
  onInsert: (command: string) => void;
  /**
   * The last "Suggest command" answer, or `null`. Owned by the page; #57 sets
   * it from the API. The user may edit it before inserting.
   */
  suggestion?: string | null;
}

const MODES: Array<{ value: TerminalAiMode; label: string }> = [
  { value: 'suggest', label: 'Suggest command' },
  { value: 'explain', label: 'Explain' },
  { value: 'summarize', label: 'Summarize session' },
];

/** A suggested command with Insert and Copy. Exported for tests. */
export function AiSuggestionCard({ command, onInsert }: { command: string; onInsert: (command: string) => void }) {
  const [value, setValue] = useState(command);
  useEffect(() => setValue(command), [command]);
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, display: 'grid', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        Suggested command
      </Typography>
      <TextField
        value={value}
        onChange={(e) => setValue(e.target.value)}
        size="small"
        multiline
        slotProps={{ htmlInput: { 'aria-label': 'Suggested command', spellCheck: false, style: { fontFamily: 'monospace' } } }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<InsertIcon />}
          disabled={!value.trim()}
          onClick={() => onInsert(value)}
        >
          Insert into terminal
        </Button>
        <Button size="small" startIcon={<CopyIcon />} onClick={() => void navigator.clipboard?.writeText(value)}>
          Copy
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Insert never runs it. You press Enter.
      </Typography>
    </Box>
  );
}

function ComingSoon({ action }: { action: string }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
      <Button variant="contained" size="small" disabled>
        {action}
      </Button>
      <Typography variant="caption" color="text.secondary">
        {AI_COMING_SOON}
      </Typography>
    </Box>
  );
}

function PanelBody({ onClose, onInsert, suggestion }: Omit<TerminalAiPanelProps, 'open' | 'variant'>) {
  const [mode, setMode] = useState<TerminalAiMode>('suggest');
  const [ask, setAsk] = useState('');

  let body: ReactNode;
  if (mode === 'suggest') {
    body = (
      <>
        <TextField
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Describe what you want to do"
          size="small"
          multiline
          minRows={2}
          slotProps={{ htmlInput: { 'aria-label': 'Describe a command' } }}
        />
        <ComingSoon action="Suggest" />
        {suggestion && <AiSuggestionCard command={suggestion} onInsert={onInsert} />}
      </>
    );
  } else if (mode === 'explain') {
    body = (
      <>
        <Typography variant="body2" color="text.secondary">
          Explains the text selected in the terminal, or the last error block when nothing is selected.
        </Typography>
        <ComingSoon action="Explain" />
      </>
    );
  } else {
    body = (
      <>
        <Typography variant="body2" color="text.secondary">
          Summarizes this session in the background and shows the result here when it is ready.
        </Typography>
        <ComingSoon action="Summarize" />
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <AssistantIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Assistant
        </Typography>
        <Tooltip title="Close assistant">
          <IconButton size="small" aria-label="Close assistant" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, p: 2, overflowY: 'auto', minHeight: 0, alignContent: 'start' }}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          size="small"
          aria-label="Assistant actions"
          onChange={(_e, next: TerminalAiMode | null) => next && setMode(next)}
          sx={{ flexWrap: 'wrap' }}
        >
          {MODES.map((m) => (
            <ToggleButton key={m.value} value={m.value} sx={{ textTransform: 'none' }}>
              {m.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {body}
        <Alert severity="info" variant="outlined" sx={{ typography: 'caption' }}>
          Nothing leaves this page until you ask. Each request will show the exact redacted text that is sent, and a
          server set to never send output to AI sends none.
        </Alert>
      </Box>
    </Box>
  );
}

/**
 * The terminal AI panel (issue #77), page-owned (not a `contextPane`). On `md`
 * and up it docks right of the panes, resizable between 320 and 480 px; below,
 * it is a bottom sheet. The page renders it only when `useTerminalAiAvailable`
 * says so (the `ai` feature on and `ai:use`).
 *
 * Until #57, #58 and #59 ship their APIs the three actions render disabled
 * with {@link AI_COMING_SOON}; no endpoint is called. The Insert path is
 * live: a suggestion's Insert hands the (editable) command to `onInsert`,
 * which types it without a newline. Nothing is ever run automatically.
 */
export function TerminalAiPanel({ open, onClose, variant, onInsert, suggestion = null }: TerminalAiPanelProps) {
  const [width, setWidth] = useState(AI_PANEL_DEFAULT_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);

  if (variant === 'sheet') {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        slotProps={{
          paper: {
            'aria-label': 'AI assistant',
            sx: { maxHeight: '75dvh', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          } as object,
        }}
      >
        <PanelBody onClose={onClose} onInsert={onInsert} suggestion={suggestion} />
      </Drawer>
    );
  }

  if (!open) return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const right = panelRef.current?.getBoundingClientRect().right ?? 0;
    setWidth(Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, Math.round(right - e.clientX))));
  };

  return (
    <Box
      ref={panelRef}
      component="aside"
      aria-label="AI assistant"
      data-testid="terminal-ai-panel"
      style={{ width }}
      sx={{
        position: 'relative',
        flexShrink: 0,
        minHeight: 0,
        bgcolor: 'background.paper',
        borderLeft: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        role="separator"
        aria-label="Resize assistant"
        aria-orientation="vertical"
        aria-valuemin={AI_PANEL_MIN_WIDTH}
        aria-valuemax={AI_PANEL_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
          if (!step) return;
          e.preventDefault();
          setWidth((w) => Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, w + step)));
        }}
        sx={{
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 1,
          touchAction: 'none',
          '&:hover, &:focus-visible': { bgcolor: 'primary.main', opacity: 0.6, outline: 'none' },
        }}
      />
      <PanelBody onClose={onClose} onInsert={onInsert} suggestion={suggestion} />
    </Box>
  );
}
