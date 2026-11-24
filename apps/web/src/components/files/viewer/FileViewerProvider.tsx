/**
 * The entry point other features open files through (issue #154; callers:
 * terminal links #155, the file browser #156):
 *
 * ```ts
 * const { openFile } = useOpenFile();
 * openFile({ profileId, path, sessionId, line });
 * ```
 *
 * `openFile` shows the viewer in a full-screen dialog over the current page,
 * so a terminal keeps its connection; the dialog links to the deep-linkable
 * page (`fileViewerPath`, the route `/servers/:id/files/view`). Without a
 * provider (a page outside the signed-in shell) it navigates to that page.
 *
 * This module is small on purpose: the viewer and CodeMirror load only when a
 * file is opened (`lazy`).
 */
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

/** What to open: the server, the path, and optionally the session and the line. */
export interface OpenFileTarget {
  profileId: string;
  /** Absolute, `~/...`, or relative to the session's working directory (else home). */
  path: string;
  /** Resolves a relative path against this terminal session's working directory. */
  sessionId?: string;
  /** 1-based line to jump to. */
  line?: number;
}

/** The deep link of the viewer page for a target. */
export function fileViewerPath(target: OpenFileTarget): string {
  const search = new URLSearchParams({ path: target.path });
  if (target.sessionId) search.set('sessionId', target.sessionId);
  if (target.line && target.line > 0) search.set('line', String(Math.floor(target.line)));
  return `/servers/${encodeURIComponent(target.profileId)}/files/view?${search.toString()}`;
}

/** Reads a target back from the page's route parameters and query. */
export function parseFileViewerSearch(profileId: string | undefined, search: URLSearchParams): OpenFileTarget | null {
  const path = search.get('path');
  if (!profileId || !path) return null;
  const line = Number(search.get('line'));
  return {
    profileId,
    path,
    sessionId: search.get('sessionId') ?? undefined,
    line: Number.isInteger(line) && line > 0 ? line : undefined,
  };
}

interface FileViewerContextValue {
  openFile: (target: OpenFileTarget) => void;
  closeFile: () => void;
}

const FileViewerContext = createContext<FileViewerContextValue | null>(null);

const FileViewerDialog = lazy(() => import('./FileViewerDialog'));

/** Mounted once around the signed-in shell (`SHELL_PROVIDERS` in `App.tsx`). */
export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<OpenFileTarget | null>(null);
  const openFile = useCallback((next: OpenFileTarget) => setTarget({ ...next }), []);
  const closeFile = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ openFile, closeFile }), [openFile, closeFile]);
  return (
    <FileViewerContext.Provider value={value}>
      {children}
      {target && (
        <Suspense fallback={null}>
          <FileViewerDialog target={target} onClose={closeFile} />
        </Suspense>
      )}
    </FileViewerContext.Provider>
  );
}

/** `openFile` (and `closeFile`): the dialog when a provider is mounted, else the viewer page. */
export function useOpenFile(): FileViewerContextValue {
  const context = useContext(FileViewerContext);
  const navigate = useNavigate();
  const fallback = useMemo<FileViewerContextValue>(
    () => ({ openFile: (target) => navigate(fileViewerPath(target)), closeFile: () => undefined }),
    [navigate],
  );
  return context ?? fallback;
}
