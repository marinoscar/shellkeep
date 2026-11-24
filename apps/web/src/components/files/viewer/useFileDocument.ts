/**
 * Loads one remote file for the viewer and keeps it current (issue #154).
 *
 * The guardrails are the API's, read from its answers rather than from the
 * `files` system settings (admin-only, `system_settings:read`):
 *
 *   - `stat` says text or binary (`isText`) and the size;
 *   - the first `content` read without a `length` returns at most the
 *     full-view cap: `eof` means the whole file fits (full mode), otherwise the
 *     file is paged and that window's length is the window size;
 *   - `FILE_TOO_LARGE` (413) is above the paged cap (download only) and
 *     `FILE_IS_BINARY` (415) is a binary file the sniff of `stat` missed.
 *
 * Images are previewed (not read as text) up to {@link IMAGE_PREVIEW_MAX_BYTES}.
 *
 * Follow polls `stat` every {@link FOLLOW_INTERVAL_MS} and reads the new range;
 * it skips while the page is hidden and stops on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../services/api';
import {
  readRemoteFile,
  statRemoteFile,
  type RemoteFileContent,
  type RemoteFileRef,
  type RemoteFileStat,
} from '../../../services/files-api';
import { DEFAULT_FILES_SYSTEM_SETTINGS } from '../../../lib/files/system-settings';
import { isImagePath } from '../../../lib/files/viewer/language';
import { previousOffset, tailOffset, trimToTail } from '../../../lib/files/viewer/text';

/** How often follow polls the size. */
export const FOLLOW_INTERVAL_MS = 2500;

/**
 * The largest image previewed: the API's default full-view cap. The real cap
 * is in the admin-only settings, so the viewer uses the default; a larger
 * image gets the download card.
 */
export const IMAGE_PREVIEW_MAX_BYTES = DEFAULT_FILES_SYSTEM_SETTINGS.fullViewMaxBytes;

export interface TextDocument {
  mode: 'full' | 'paged';
  text: string;
  /** Byte offset of the first character shown. */
  offset: number;
  /** Bytes the shown text covers. */
  length: number;
  size: number;
  eof: boolean;
  /** The window size the API serves (the full-view cap, as far as the client can tell). */
  windowBytes: number;
}

export type FileDocumentState =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string; httpStatus?: number }
  | { status: 'image'; stat: RemoteFileStat }
  | { status: 'binary'; stat: RemoteFileStat }
  | { status: 'too-large'; stat: RemoteFileStat }
  | { status: 'text'; stat: RemoteFileStat; doc: TextDocument };

export interface UseFileDocumentOptions {
  /** Applied to every window read (ANSI stripping for logs). */
  transform?: (text: string) => string;
  /** Open at the end: the last window of a paged file. */
  startAtTail?: boolean;
}

export interface UseFileDocumentResult {
  state: FileDocumentState;
  /** A window is loading (paging, follow). */
  busy: boolean;
  /** Load the window starting at `offset` (paged mode). */
  loadAt: (offset: number) => Promise<void>;
  head: () => Promise<void>;
  tail: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  reload: () => void;
  following: boolean;
  setFollowing: (on: boolean) => void;
  /** Why follow stopped, when it stopped on an error. */
  followError: string | null;
  /** Bumped whenever new text arrived at the end (tail, follow), for the editor to scroll. */
  endKey: number;
}

const encoder = new TextEncoder();

function errorMessage(error: unknown): { message: string; code?: string; httpStatus?: number } {
  if (error instanceof ApiError) {
    const byCode: Record<string, string> = {
      FILE_NOT_FOUND: 'The file does not exist on the server.',
      FILE_NOT_A_FILE: 'This path is not a regular file.',
      FILE_PERMISSION_DENIED: 'The server refused to read this file (permission denied).',
      FILE_PATH_INVALID: 'The path is not valid.',
      FILES_RATE_LIMITED: 'Too many file requests. Wait a moment and try again.',
      SFTP_UNAVAILABLE: 'The server does not offer SFTP, so files cannot be read.',
      SFTP_TIMEOUT: 'The server took too long to answer.',
    };
    const message = (error.code && byCode[error.code]) || error.message || 'The file could not be read.';
    return { message, code: error.code, httpStatus: error.status };
  }
  return { message: error instanceof Error ? error.message : 'The file could not be read.' };
}

export function useFileDocument(ref: RemoteFileRef, options: UseFileDocumentOptions = {}): UseFileDocumentResult {
  const { profileId, path, sessionId } = ref;
  const [state, setState] = useState<FileDocumentState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [following, setFollowingState] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [endKey, setEndKey] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const transformRef = useRef(options.transform);
  transformRef.current = options.transform;
  const startAtTailRef = useRef(options.startAtTail);
  startAtTailRef.current = options.startAtTail;
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);

  const target = useCallback(() => ({ profileId, path, sessionId }), [profileId, path, sessionId]);
  const apply = useCallback((text: string) => (transformRef.current ? transformRef.current(text) : text), []);

  const toDoc = useCallback(
    (content: RemoteFileContent, windowBytes: number, mode: 'full' | 'paged'): TextDocument => ({
      mode,
      text: apply(content.text),
      offset: content.offset,
      length: content.length,
      size: content.size,
      eof: content.eof,
      windowBytes,
    }),
    [apply],
  );

  // The first load: stat, then decide.
  useEffect(() => {
    const generation = ++generationRef.current;
    const live = () => generationRef.current === generation;
    setState({ status: 'loading' });
    setFollowingState(false);
    setFollowError(null);
    (async () => {
      let stat: RemoteFileStat | null = null;
      try {
        stat = await statRemoteFile(target());
        if (!live()) return;
        const effective = stat.type === 'symlink' ? stat.targetType : stat.type;
        if (effective === 'dir') {
          setState({ status: 'error', message: 'This path is a directory.', code: 'FILE_NOT_A_FILE' });
          return;
        }
        if (isImagePath(stat.path || path)) {
          setState(stat.size <= IMAGE_PREVIEW_MAX_BYTES ? { status: 'image', stat } : { status: 'too-large', stat });
          return;
        }
        if (!stat.isText) {
          setState({ status: 'binary', stat });
          return;
        }
        const first = await readRemoteFile(target(), { offset: 0 });
        if (!live()) return;
        if (first.eof) {
          setState({ status: 'text', stat, doc: toDoc(first, Math.max(first.length, 1), 'full') });
          if (startAtTailRef.current) setEndKey((k) => k + 1);
          return;
        }
        const windowBytes = Math.max(first.length, 1);
        if (startAtTailRef.current) {
          const last = await readRemoteFile(target(), { offset: tailOffset(first.size, windowBytes) });
          if (!live()) return;
          setState({ status: 'text', stat, doc: toDoc(last, windowBytes, 'paged') });
          setEndKey((k) => k + 1);
          return;
        }
        setState({ status: 'text', stat, doc: toDoc(first, windowBytes, 'paged') });
      } catch (error) {
        if (!live()) return;
        if (stat && error instanceof ApiError && (error.code === 'FILE_TOO_LARGE' || error.code === 'FILE_IS_BINARY')) {
          setState({ status: error.code === 'FILE_TOO_LARGE' ? 'too-large' : 'binary', stat });
          return;
        }
        setState({ status: 'error', ...errorMessage(error) });
      }
    })();
  }, [target, toDoc, path, reloadKey]);

  const loadAt = useCallback(
    async (offset: number) => {
      const current = stateRef.current;
      if (current.status !== 'text') return;
      const generation = generationRef.current;
      setBusy(true);
      try {
        const content = await readRemoteFile(target(), { offset: Math.max(0, Math.min(offset, current.doc.size)) });
        if (generationRef.current !== generation) return;
        setState({ status: 'text', stat: current.stat, doc: toDoc(content, current.doc.windowBytes, current.doc.mode) });
        if (content.eof) setEndKey((k) => k + 1);
      } catch (error) {
        if (generationRef.current !== generation) return;
        setState({ status: 'error', ...errorMessage(error) });
      } finally {
        setBusy(false);
      }
    },
    [target, toDoc],
  );

  const windowBytes = () => {
    const current = stateRef.current;
    return current.status === 'text' ? current.doc.windowBytes : 1;
  };
  const head = useCallback(() => loadAt(0), [loadAt]);
  const tail = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'text') return;
    if (current.doc.mode === 'full') {
      setEndKey((k) => k + 1);
      return;
    }
    await loadAt(tailOffset(current.doc.size, current.doc.windowBytes));
  }, [loadAt]);
  const next = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'text' || current.doc.eof) return;
    await loadAt(current.doc.offset + current.doc.length);
  }, [loadAt]);
  const previous = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'text' || current.doc.offset === 0) return;
    await loadAt(previousOffset(current.doc.offset, windowBytes()));
  }, [loadAt]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const setFollowing = useCallback(
    (on: boolean) => {
      setFollowError(null);
      setFollowingState(on);
      const current = stateRef.current;
      // Following shows the end: a paged view away from it jumps there first.
      if (on && current.status === 'text') {
        if (!current.doc.eof) void loadAt(tailOffset(current.doc.size, current.doc.windowBytes));
        else setEndKey((k) => k + 1);
      }
    },
    [loadAt],
  );

  // Follow: poll the size, read what was appended.
  useEffect(() => {
    if (!following) return;
    let inFlight = false;
    let stopped = false;
    const tick = async () => {
      if (inFlight || stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const current = stateRef.current;
      if (current.status !== 'text' || !current.doc.eof) return;
      inFlight = true;
      const generation = generationRef.current;
      try {
        const stat = await statRemoteFile(target());
        if (stopped || generationRef.current !== generation) return;
        const end = current.doc.offset + current.doc.length;
        if (stat.size < end) {
          // Truncated or rotated: show the new tail.
          const content = await readRemoteFile(target(), { offset: tailOffset(stat.size, current.doc.windowBytes) });
          if (stopped || generationRef.current !== generation) return;
          setState({ status: 'text', stat, doc: { ...toDoc(content, current.doc.windowBytes, current.doc.mode) } });
          setEndKey((k) => k + 1);
          return;
        }
        if (stat.size === end) return;
        const content = await readRemoteFile(target(), { offset: end });
        if (stopped || generationRef.current !== generation) return;
        const latest = stateRef.current;
        if (latest.status !== 'text') return;
        const appended = apply(content.text);
        const combined = latest.doc.text + appended;
        const { text, dropped } = trimToTail(combined, Math.max(latest.doc.windowBytes, 64 * 1024));
        const droppedBytes = dropped > 0 ? encoder.encode(combined.slice(0, dropped)).length : 0;
        setState({
          status: 'text',
          stat,
          doc: {
            ...latest.doc,
            text,
            offset: latest.doc.offset + droppedBytes,
            length: latest.doc.length - droppedBytes + content.length,
            size: content.size,
            eof: content.eof,
          },
        });
        setEndKey((k) => k + 1);
      } catch (error) {
        if (stopped) return;
        setFollowError(errorMessage(error).message);
        setFollowingState(false);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void tick(), FOLLOW_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [following, target, toDoc, apply]);

  return { state, busy, loadAt, head, tail, next, previous, reload, following, setFollowing, followError, endKey };
}
