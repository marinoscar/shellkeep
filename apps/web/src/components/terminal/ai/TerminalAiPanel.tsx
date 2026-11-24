import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Drawer,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoAwesomeOutlined as AssistantIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { CommandAssistPanel } from './CommandAssistPanel';
import { ExplainPanel, type ExplainTrigger } from './ExplainPanel';
import { SessionSummaryPanel } from './SessionSummaryPanel';

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
  /** The active session's id; "Suggest command" asks about it. `null` disables asking. */
  sessionId?: string | null;
  /** Changes when the keyboard shortcut asks to focus the prompt (#57). */
  focusRequest?: number;
  /** A request to explain a selection or the last error (#58); switches to the Explain action. */
  explainTrigger?: ExplainTrigger | null;
  /** Called once the Explain action has taken `explainTrigger`. */
  onExplainTriggerHandled?: () => void;
  /** The focused terminal's selected text, or `''` (#58). */
  getSelection?: () => string;
}

const MODES: Array<{ value: TerminalAiMode; label: string }> = [
  { value: 'suggest', label: 'Suggest command' },
  { value: 'explain', label: 'Explain' },
  { value: 'summarize', label: 'Summarize session' },
];

function PanelBody({
  onClose,
  onInsert,
  sessionId = null,
  focusRequest = 0,
  explainTrigger = null,
  onExplainTriggerHandled,
  getSelection = () => '',
}: Omit<TerminalAiPanelProps, 'open' | 'variant'>) {
  const [mode, setMode] = useState<TerminalAiMode>(explainTrigger ? 'explain' : 'suggest');
  useEffect(() => {
    if (explainTrigger) setMode('explain');
  }, [explainTrigger]);

  let body: ReactNode;
  if (mode === 'suggest') {
    body = <CommandAssistPanel sessionId={sessionId} onInsert={onInsert} focusRequest={focusRequest} />;
  } else if (mode === 'explain') {
    body = (
      <ExplainPanel
        sessionId={sessionId}
        onInsert={onInsert}
        getSelection={getSelection}
        trigger={explainTrigger}
        onTriggerHandled={onExplainTriggerHandled}
      />
    );
  } else {
    body = <SessionSummaryPanel sessionId={sessionId} />;
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
 * "Suggest command" (#57, `CommandAssistPanel`), "Explain" (#58, `ExplainPanel`) and "Summarize session" (#59,
 * `SessionSummaryPanel`) are all live. Insert hands the command to
 * `onInsert`, which pastes it without a newline. Nothing is ever run automatically.
 */
export function TerminalAiPanel({ open, onClose, variant, onInsert, sessionId = null, focusRequest = 0, ...explain }: TerminalAiPanelProps) {
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
        <PanelBody onClose={onClose} onInsert={onInsert} sessionId={sessionId} focusRequest={focusRequest} {...explain} />
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
      <PanelBody onClose={onClose} onInsert={onInsert} sessionId={sessionId} focusRequest={focusRequest} {...explain} />
    </Box>
  );
}
