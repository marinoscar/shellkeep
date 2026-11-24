/**
 * The run matrix (issue #65, Subtask D): one row per server, one column per step. Every cell
 * shows a status icon AND its text label (never colour alone), the duration, and the exit code
 * when it is not 0. The header row and the server column are sticky.
 *
 * Rows are virtualized here (fixed row height, only the rows in view plus an overscan are
 * mounted) because a run reaches 500 servers: the platform `DataTable`'s grid cannot pin a
 * column, and a hand-rolled window needs no new dependency.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import type { RunStepRow, RunTargetRow } from '../api/types';
import { formatDuration } from '../lib/format';
import { statusMeta, toneColor } from '../lib/statusMeta';
import { stepKindMeta } from '../lib/stepKinds';

export const ROW_HEIGHT = 52;
export const HEADER_HEIGHT = 44;
export const OVERSCAN = 6;
/** The viewport height assumed before layout (and in a layout-free test DOM). */
export const FALLBACK_VIEWPORT = 480;

export interface RunMatrixProps {
  targets: readonly RunTargetRow[];
  onCellClick: (target: RunTargetRow, stepIndex: number) => void;
  height?: number | string;
}

/** The visible window of rows for a scroll position. */
export function visibleRange(scrollTop: number, viewport: number, total: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  return { start, end };
}

const Cell = memo(function Cell({
  target,
  step,
  onClick,
}: {
  target: RunTargetRow;
  step: RunStepRow;
  onClick: (target: RunTargetRow, stepIndex: number) => void;
}) {
  const meta = statusMeta(step.status);
  const { Icon } = meta;
  const duration = formatDuration(step.durationMs);
  const exit = step.exitCode !== null && step.exitCode !== 0 ? `exit ${step.exitCode}` : '';
  return (
    <Box role="cell" sx={{ minWidth: 0, display: 'flex', alignItems: 'stretch', p: 0.5 }}>
      <ButtonBase
        onClick={() => onClick(target, step.stepIndex)}
        aria-label={`${target.serverName}, ${step.name}: ${meta.label}${duration ? `, ${duration}` : ''}${exit ? `, ${exit}` : ''}. Open log`}
        data-status={step.status}
        sx={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          gap: 0.75,
          px: 1,
          borderRadius: 1,
          textAlign: 'left',
          '&:hover, &.Mui-focusVisible': { bgcolor: 'action.hover' },
        }}
      >
        <Icon fontSize="small" sx={{ color: toneColor(meta.tone), flexShrink: 0 }} aria-hidden="true" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ lineHeight: 1.2 }}>
            {meta.label}
          </Typography>
          {(duration || exit) && (
            <Typography variant="caption" noWrap sx={{ color: exit ? 'error.main' : 'text.secondary', display: 'block', lineHeight: 1.2 }}>
              {[duration, exit].filter(Boolean).join(' · ')}
            </Typography>
          )}
        </Box>
      </ButtonBase>
    </Box>
  );
});

export function RunMatrix({ targets, onCellClick, height = 'min(70vh, 720px)' }: RunMatrixProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const steps = targets[0]?.steps ?? [];
  const columns = `minmax(160px, 220px) repeat(${Math.max(steps.length, 1)}, minmax(132px, 1fr))`;
  const minWidth = 180 + Math.max(steps.length, 1) * 132;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => setViewport(el.clientHeight > 0 ? el.clientHeight - HEADER_HEIGHT : FALLBACK_VIEWPORT);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const { start, end } = visibleRange(scrollTop, viewport, targets.length);
  const visible = targets.slice(start, end);

  return (
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      role="table"
      aria-label="Run matrix: servers by steps"
      aria-rowcount={targets.length + 1}
      aria-colcount={steps.length + 1}
      tabIndex={0}
      sx={{
        height,
        overflow: 'auto',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        position: 'relative',
      }}
    >
      <Box sx={{ minWidth }}>
        <Box
          role="row"
          aria-rowindex={1}
          sx={{
            display: 'grid',
            gridTemplateColumns: columns,
            height: HEADER_HEIGHT,
            position: 'sticky',
            top: 0,
            zIndex: 2,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box
            role="columnheader"
            sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', px: 1.5, borderRight: 1, borderColor: 'divider' }}
          >
            <Typography variant="subtitle2" component="span">Server</Typography>
          </Box>
          {steps.map((step) => {
            const { Icon, label } = stepKindMeta(step.kind);
            return (
              <Box key={step.stepIndex} role="columnheader" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, minWidth: 0 }}>
                <Icon fontSize="small" sx={{ color: 'text.secondary' }} aria-label={label} />
                <Typography variant="subtitle2" component="span" noWrap title={step.name}>
                  {step.stepIndex + 1}. {step.name}
                </Typography>
              </Box>
            );
          })}
        </Box>
        <Box role="rowgroup" sx={{ position: 'relative', height: targets.length * ROW_HEIGHT }}>
          {visible.map((target, offset) => {
            const index = start + offset;
            const tMeta = statusMeta(target.status);
            const TIcon = tMeta.Icon;
            return (
              <Box
                key={target.id}
                role="row"
                aria-rowindex={index + 2}
                data-testid="matrix-row"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: columns,
                  position: 'absolute',
                  top: index * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <Box
                  role="rowheader"
                  sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, minWidth: 0, borderRight: 1, borderColor: 'divider' }}
                >
                  <TIcon fontSize="small" sx={{ color: toneColor(tMeta.tone), flexShrink: 0 }} aria-hidden="true" />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {target.serverName}
                    </Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
                      {tMeta.label}
                      {target.errorCode ? ` · ${target.errorCode}` : ''}
                    </Typography>
                  </Box>
                </Box>
                {target.steps.map((step) => (
                  <Cell key={step.stepIndex} target={target} step={step} onClick={onCellClick} />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
