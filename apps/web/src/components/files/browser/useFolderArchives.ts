/**
 * Folder archives of the file browser (issue #158, epic #151).
 *
 * `start(path, name)` queues the `files.archive` job; the hook then polls the archive's status (every
 * `ARCHIVE_POLL_MS`, only while something is pending or running) and exposes one item per archive:
 * pending, ready (with `download`) or failed (with the API's reason). Items are kept in memory only: an
 * archive outlives the page for 24 hours on the server, but the browser asks for a new one. Nothing here
 * reads a breakpoint.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadFolderArchive,
  getFolderArchive,
  requestFolderArchive,
  type FolderArchive,
} from '../../../services/files-api';

/** How often a building archive is asked for. */
export const ARCHIVE_POLL_MS = 2000;

export type ArchiveItemStatus = 'starting' | 'building' | 'ready' | 'failed' | 'expired';

export interface ArchiveItem {
  /** The archive id once the API accepted the request, else a local key. */
  id: string;
  name: string;
  path: string;
  status: ArchiveItemStatus;
  sizeBytes: number | null;
  warning: string | null;
  /** Why it failed or could not start. */
  message: string | null;
}

export interface UseFolderArchivesOptions {
  profileId: string;
  sessionId?: string;
}

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'something went wrong';

function fromServer(item: ArchiveItem, archive: FolderArchive): ArchiveItem {
  const status: ArchiveItemStatus =
    archive.status === 'pending' || archive.status === 'running' ? 'building' : archive.status;
  return {
    ...item,
    status,
    sizeBytes: archive.sizeBytes,
    warning: archive.warning,
    message:
      archive.status === 'failed'
        ? archive.errorMessage || 'The archive could not be built.'
        : archive.status === 'expired'
          ? 'The archive expired; request a new one.'
          : null,
  };
}

export const isBuildingArchive = (item: ArchiveItem): boolean => item.status === 'starting' || item.status === 'building';

export function useFolderArchives({ profileId, sessionId }: UseFolderArchivesOptions) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const localKey = useRef(0);

  const patch = useCallback((id: string, change: Partial<ArchiveItem> | ((item: ArchiveItem) => ArchiveItem)) => {
    setItems((all) => all.map((item) => (item.id === id ? (typeof change === 'function' ? change(item) : { ...item, ...change }) : item)));
  }, []);

  const start = useCallback(
    async (path: string, name: string) => {
      const key = `local-${localKey.current++}`;
      const base: ArchiveItem = { id: key, name, path, status: 'starting', sizeBytes: null, warning: null, message: null };
      setItems((all) => [...all, base]);
      setAnnouncement(`Building an archive of ${name}`);
      try {
        const { archiveId } = await requestFolderArchive({ profileId, path, ...(sessionId ? { sessionId } : {}) });
        patch(key, { id: archiveId, status: 'building' });
      } catch (error) {
        patch(key, { status: 'failed', message: errorText(error) });
        setAnnouncement(`The archive of ${name} could not start`);
      }
    },
    [profileId, sessionId, patch],
  );

  // One timer while anything builds; each tick asks for every building archive.
  const building = items.some((item) => item.status === 'building');
  useEffect(() => {
    if (!building) return undefined;
    let cancelled = false;
    const tick = async () => {
      for (const item of itemsRef.current.filter((i) => i.status === 'building')) {
        try {
          const archive = await getFolderArchive(item.id);
          if (cancelled) return;
          patch(item.id, (current) => fromServer(current, archive));
          if (archive.status === 'ready') setAnnouncement(`The archive of ${item.name} is ready`);
          if (archive.status === 'failed') setAnnouncement(`The archive of ${item.name} failed`);
        } catch (error) {
          if (cancelled) return;
          // A 404 means it expired or access went away; any other error is retried on the next tick.
          const status = (error as { status?: number } | null)?.status;
          if (status === 404) patch(item.id, { status: 'failed', message: 'The archive is no longer available.' });
        }
      }
    };
    const timer = setInterval(() => void tick(), ARCHIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [building, patch]);

  const download = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        await downloadFolderArchive(id);
        return null;
      } catch (error) {
        return errorText(error);
      }
    },
    [],
  );

  const dismiss = useCallback((id: string) => setItems((all) => all.filter((item) => item.id !== id)), []);
  const clearFinished = useCallback(() => setItems((all) => all.filter(isBuildingArchive)), []);

  return { items, announcement, start, download, dismiss, clearFinished };
}
