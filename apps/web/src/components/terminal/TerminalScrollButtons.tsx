import { type RefObject, useEffect, useRef } from 'react';
import { Box, Fab } from '@mui/material';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { dispatchXtermScroll } from '../../utils/dispatchXtermScroll';

export interface TerminalScrollButtonsProps {
  containerRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
}

const SCROLL_STEP = 42; // ~3 lines at fontSize 14 / lineHeight 1

export function TerminalScrollButtons({ containerRef, visible }: TerminalScrollButtonsProps) {
  // Two pairs of timers: one for up, one for down
  const upInitialTimer = useRef<number | null>(null);
  const upIntervalTimer = useRef<number | null>(null);
  const downInitialTimer = useRef<number | null>(null);
  const downIntervalTimer = useRef<number | null>(null);

  const clearUp = () => {
    if (upInitialTimer.current !== null) window.clearTimeout(upInitialTimer.current);
    if (upIntervalTimer.current !== null) window.clearInterval(upIntervalTimer.current);
    upInitialTimer.current = null;
    upIntervalTimer.current = null;
  };

  const clearDown = () => {
    if (downInitialTimer.current !== null) window.clearTimeout(downInitialTimer.current);
    if (downIntervalTimer.current !== null) window.clearInterval(downIntervalTimer.current);
    downInitialTimer.current = null;
    downIntervalTimer.current = null;
  };

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      clearUp();
      clearDown();
    };
  }, []);

  const onUpPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    clearUp();
    dispatchXtermScroll(containerRef.current, -SCROLL_STEP);
    upInitialTimer.current = window.setTimeout(() => {
      upIntervalTimer.current = window.setInterval(() => {
        dispatchXtermScroll(containerRef.current, -SCROLL_STEP);
      }, 70);
    }, 300);
  };

  const onUpPointerEnd = () => clearUp();

  const onDownPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    clearDown();
    dispatchXtermScroll(containerRef.current, SCROLL_STEP);
    downInitialTimer.current = window.setTimeout(() => {
      downIntervalTimer.current = window.setInterval(() => {
        dispatchXtermScroll(containerRef.current, SCROLL_STEP);
      }, 70);
    }, 300);
  };

  const onDownPointerEnd = () => clearDown();

  if (!visible) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        right: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <Fab
        size="small"
        color="primary"
        aria-label="Scroll up"
        sx={{
          width: 44,
          height: 44,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(255, 255, 255, 0.08)',
          '&:hover': { filter: 'brightness(1.15)' },
        }}
        onPointerDown={onUpPointerDown}
        onPointerUp={onUpPointerEnd}
        onPointerLeave={onUpPointerEnd}
        onPointerCancel={onUpPointerEnd}
      >
        <KeyboardArrowUpIcon />
      </Fab>
      <Fab
        size="small"
        color="primary"
        aria-label="Scroll down"
        sx={{
          width: 44,
          height: 44,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(255, 255, 255, 0.08)',
          '&:hover': { filter: 'brightness(1.15)' },
        }}
        onPointerDown={onDownPointerDown}
        onPointerUp={onDownPointerEnd}
        onPointerLeave={onDownPointerEnd}
        onPointerCancel={onDownPointerEnd}
      >
        <KeyboardArrowDownIcon />
      </Fab>
    </Box>
  );
}
