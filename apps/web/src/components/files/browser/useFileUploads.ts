/**
 * The upload queue of the file browser (issue #157, epic #151).
 *
 * Files are queued and sent one or two at a time (`UPLOAD_CONCURRENCY`), each
 * streamed by `uploadRemoteFile` with progress and an AbortController (Cancel
 * stops the request; the API removes the partial file). A file over the cap is
 * refused before anything is sent (the API enforces it too). A 409
 * `FILE_EXISTS` pauses that file and asks (`conflict`): Replace or Skip, once
 * or for every remaining conflict of the batch. `onIdle` runs once the queue
 * drains after at least one success, with the folders written to, so the
 * browser can refresh its listing.
 *
 * Nothing here reads a breakpoint, and no file content leaves the browser
 * except in the upload request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RemoteUploadError,
  isUploadCancelled,
  uploadRemoteFile,
  type ExistingFileDetails,
} from '../../../services/files-api';
import { formatBytes } from '../../../lib/files/system-settings';

/** Uploads in flight at once. */
export const UPLOAD_CONCURRENCY = 2;

export type UploadStatus = 'queued' | 'uploading' | 'waiting' | 'done' | 'skipped' | 'failed' | 'cancelled';

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  /** The folder it goes to (absolute). */
  dir: string;
  status: UploadStatus;
  /** Bytes sent so far. */
  loaded: number;
  /** Why it failed or was refused. */
  message?: string;
}

export type ConflictDecision = 'replace' | 'skip';

export interface UploadConflict {
  item: UploadItem;
  existing: ExistingFileDetails;
}

export interface UseFileUploadsOptions {
  profileId: string;
  sessionId?: string;
  /** The largest file the browser sends. */
  maxBytes: number;
  /** The queue drained after at least one success; `dirs` are the folders written to. */
  onIdle?: (dirs: string[]) => void;
}

const ACTIVE: UploadStatus[] = ['queued', 'uploading', 'waiting'];
export const isActiveUpload = (item: UploadItem): boolean => ACTIVE.includes(item.status);

interface Job {
  file: File;
  controller: AbortController;
  name: string;
  size: number;
  dir: string;
}

function failureMessage(error: unknown): string {
  if (error instanceof RemoteUploadError) {
    if (error.code === 'FILE_TOO_LARGE') return 'The file is larger than the server\'s upload limit';
    if (error.status === 0) return error.message;
    return error.message || 'The upload failed';
  }
  return error instanceof Error && error.message ? error.message : 'The upload failed';
}

export function useFileUploads({ profileId, sessionId, maxBytes, onIdle }: UseFileUploadsOptions) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [conflict, setConflict] = useState<(UploadConflict & { settle: (d: ConflictDecision) => void }) | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const conflictRef = useRef<typeof conflict>(null);
  conflictRef.current = conflict;

  const nextId = useRef(1);
  const jobs = useRef(new Map<number, Job>());
  const pending = useRef<number[]>([]);
  const active = useRef(0);
  const wrote = useRef(new Set<string>());
  const applyAll = useRef<ConflictDecision | null>(null);
  const conflictChain = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ profileId, sessionId, maxBytes, onIdle });
  latest.current = { profileId, sessionId, maxBytes, onIdle };
  const patch = useCallback((id: number, change: Partial<UploadItem>) => {
    setItems((all) => all.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const askConflict = useCallback((item: UploadItem, existing: ExistingFileDetails): Promise<ConflictDecision> => {
    // One question at a time; a remembered answer ("apply to all") skips the dialog.
    const answer = conflictChain.current.then(
      () =>
        new Promise<ConflictDecision>((resolve) => {
          if (applyAll.current) return resolve(applyAll.current);
          setConflict({
            item,
            existing,
            settle: (decision) => {
              setConflict(null);
              resolve(decision);
            },
          });
        }),
    );
    conflictChain.current = answer.catch(() => undefined);
    return answer;
  }, []);

  const pumpRef = useRef<() => void>(() => undefined);

  const run = useCallback(
    async (id: number) => {
      const job = jobs.current.get(id);
      if (!job) return;
      const item: UploadItem = { id, name: job.name, size: job.size, dir: job.dir, status: 'waiting', loaded: 0 };
      const { profileId: server, sessionId: session } = latest.current;
      patch(id, { status: 'uploading', loaded: 0 });
      setAnnouncement(`Uploading ${item.name}`);
      let overwrite = false;
      try {
        for (;;) {
          try {
            await uploadRemoteFile({
              profileId: server,
              dir: item.dir,
              name: item.name,
              file: job.file,
              overwrite,
              ...(session ? { sessionId: session } : {}),
              signal: job.controller.signal,
              onProgress: ({ loaded }) => patch(id, { loaded }),
            });
            break;
          } catch (error) {
            if (!(error instanceof RemoteUploadError) || error.code !== 'FILE_EXISTS' || overwrite) throw error;
            patch(id, { status: 'waiting', loaded: 0 });
            const details = (error.details ?? {}) as ExistingFileDetails;
            const decision = await askConflict(item, details);
            if (job.controller.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
            if (decision === 'skip') {
              patch(id, { status: 'skipped', loaded: 0 });
              setAnnouncement(`Skipped ${item.name}`);
              return;
            }
            overwrite = true;
            patch(id, { status: 'uploading', loaded: 0 });
          }
        }
        patch(id, { status: 'done', loaded: item.size });
        wrote.current.add(item.dir);
        setAnnouncement(`Uploaded ${item.name}`);
      } catch (error) {
        if (isUploadCancelled(error)) {
          patch(id, { status: 'cancelled' });
          setAnnouncement(`Cancelled the upload of ${item.name}`);
        } else {
          const message = failureMessage(error);
          patch(id, { status: 'failed', message });
          setAnnouncement(`Could not upload ${item.name}: ${message}`);
        }
      } finally {
        jobs.current.delete(id);
        active.current -= 1;
        pumpRef.current();
      }
    },
    [patch, askConflict],
  );

  pumpRef.current = () => {
    while (active.current < UPLOAD_CONCURRENCY && pending.current.length > 0) {
      const id = pending.current.shift() as number;
      if (!jobs.current.has(id)) continue;
      active.current += 1;
      void run(id);
    }
    if (active.current === 0 && pending.current.length === 0) {
      applyAll.current = null;
      if (wrote.current.size > 0) {
        const dirs = [...wrote.current];
        wrote.current.clear();
        latest.current.onIdle?.(dirs);
      }
    }
  };

  /** Queues files for a folder. A file over the cap is refused here, before anything is sent. */
  const enqueue = useCallback((files: File[], dir: string) => {
    if (files.length === 0) return;
    const added: UploadItem[] = [];
    const refused: string[] = [];
    for (const file of files) {
      const id = nextId.current++;
      const base: UploadItem = { id, name: file.name, size: file.size, dir, status: 'queued', loaded: 0 };
      if (file.size > latest.current.maxBytes) {
        const message = `${file.name} is larger than the upload limit of ${formatBytes(latest.current.maxBytes)}`;
        added.push({ ...base, status: 'failed', message });
        refused.push(message);
        continue;
      }
      jobs.current.set(id, { file, controller: new AbortController(), name: file.name, size: file.size, dir });
      pending.current.push(id);
      added.push(base);
    }
    setItems((all) => [...all, ...added]);
    if (refused.length > 0) setAnnouncement(refused.join('. '));
    pumpRef.current();
  }, []);

  const cancel = useCallback((id: number) => {
    const job = jobs.current.get(id);
    if (job) {
      job.controller.abort();
      if (pending.current.includes(id)) {
        // Never started: it leaves the queue without a request.
        pending.current = pending.current.filter((queued) => queued !== id);
        jobs.current.delete(id);
        patch(id, { status: 'cancelled' });
      }
    }
    if (conflictRef.current?.item.id === id) conflictRef.current.settle('skip');
  }, [patch]);

  const resolveConflict = useCallback(
    (decision: ConflictDecision, remember: boolean) => {
      if (remember) applyAll.current = decision;
      conflictRef.current?.settle(decision);
    },
    [],
  );

  const clearFinished = useCallback(() => {
    setItems((all) => all.filter(isActiveUpload));
  }, []);

  // Leaving the browser (another server, a closed panel) cancels what is still sending.
  useEffect(
    () => () => {
      for (const job of jobs.current.values()) job.controller.abort();
      pending.current = [];
    },
    [],
  );

  return { items, enqueue, cancel, clearFinished, conflict, resolveConflict, announcement };
}
