/**
 * File links in one terminal (issue #155): the source `useTerminal`'s link
 * provider asks (a cached `stat` against this session's working directory),
 * the menu state a click or a tap opens, and the touch handling.
 *
 * Touch: xterm has no hover on a touch screen, so a tap is what checks a path
 * (its underline then appears). A tap on a path already known to exist, or a
 * long-press on any path, opens the menu. A gesture that moved is a scroll
 * (`useTouchScroll` owns it) and never opens anything; these listeners are
 * passive and never call `preventDefault`, so scrolling is untouched.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { statRemoteFile } from '../../../services/files-api';
import { createFileStatCache } from '../../../lib/terminal/file-stat-cache';
import {
  fileReferenceAtPoint,
  type FileLinkTerminal,
  type PointerPosition,
  type ResolvedFileLink,
  type TerminalFileLinkSource,
} from '../../../lib/terminal/file-link-provider';

/** What a terminal needs to show file links: its server. Absent: no links. */
export interface TerminalFileLinksConfig {
  /** The session's server profile; the files routes live under it. */
  profileId: string;
  /** "Show in file browser" (#156). Omitted: the action is hidden. */
  onShowInFileBrowser?: (target: { profileId: string; path: string; type: 'file' | 'dir' | 'other' }) => void;
}

/** The open menu: which link and where. */
export interface FileLinkMenuState {
  link: ResolvedFileLink;
  anchor: PointerPosition;
}

/** A finger that moved further than this (px) is scrolling, not tapping. */
export const TAP_SLOP_PX = 10;
/** A touch held this long (ms) without moving is a long-press. */
export const LONG_PRESS_MS = 500;
/** Mouse events the browser synthesises after a touch arrive within this window (ms). */
const SYNTHETIC_MOUSE_WINDOW_MS = 800;

export function useTerminalFileLinks(
  sessionId: string,
  containerRef: RefObject<HTMLElement | null>,
  /** The terminal, once it exists (read at each tap). */
  getTerminal: () => FileLinkTerminal | null,
  config: TerminalFileLinksConfig | null | undefined,
) {
  const profileId = config?.profileId ?? null;
  const [menu, setMenu] = useState<FileLinkMenuState | null>(null);
  const lastTouchEnd = useRef(-Infinity);

  // One cache per terminal, server and session: a path is checked once per 30 s.
  const cache = useMemo(
    () =>
      profileId
        ? createFileStatCache({ stat: (path: string) => statRemoteFile({ profileId, path, sessionId }) })
        : null,
    [profileId, sessionId],
  );

  const source = useMemo<TerminalFileLinkSource | null>(() => {
    if (!cache) return null;
    return {
      resolve: (path) => cache.get(sessionId, path),
      activate: (link, anchor) => {
        // The click a tap leaves behind: the touch handler already decided.
        if (Date.now() - lastTouchEnd.current < SYNTHETIC_MOUSE_WINDOW_MS) return;
        setMenu({ link, anchor });
      },
    };
  }, [cache, sessionId]);

  // A new server or session closes a menu that belongs to the old one.
  useEffect(() => setMenu(null), [source]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cache) return undefined;
    let start: { x: number; y: number; at: number } | null = null;
    let moved = false;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
      moved = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) {
        moved = true;
        return;
      }
      if (Math.abs(touch.clientX - start.x) > TAP_SLOP_PX || Math.abs(touch.clientY - start.y) > TAP_SLOP_PX) {
        moved = true;
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      lastTouchEnd.current = Date.now();
      const began = start;
      start = null;
      if (!began || moved) return;
      const terminal = getTerminal();
      if (!terminal) return;
      const longPress = Date.now() - began.at >= LONG_PRESS_MS;
      const touch = event.changedTouches[0];
      const x = touch?.clientX ?? began.x;
      const y = touch?.clientY ?? began.y;
      const found = fileReferenceAtPoint(terminal, x, y);
      if (!found) return;
      const open = (stat: ResolvedFileLink['stat'] | null | undefined) => {
        if (stat) setMenu({ link: { ...found, stat }, anchor: { x, y } });
      };
      const known = cache.peek(sessionId, found.reference.path);
      if (known !== undefined && !longPress) {
        // An underlined link: open. A path known to be missing: nothing.
        open(known);
        return;
      }
      // A first tap only checks the path (its underline appears); a long-press opens once it is known.
      const pending = cache.get(sessionId, found.reference.path);
      if (longPress) void pending.then(open);
    };
    const onTouchCancel = () => {
      start = null;
      lastTouchEnd.current = Date.now();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [containerRef, getTerminal, cache, sessionId]);

  return { source, menu, closeMenu: () => setMenu(null) };
}
