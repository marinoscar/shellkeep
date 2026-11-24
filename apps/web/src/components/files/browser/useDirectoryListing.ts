/**
 * One directory of the file browser (issue #156): what to list (`.` while
 * following the terminal, else a path), the last listing, the loading flag
 * and the error. A listing that fails keeps the previous one on screen behind
 * the error; an answer to a superseded request is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listRemoteDirectory, type RemoteDirListing } from '../../../services/files-api';
import { listingErrorCode, listingErrorMessage } from '../../../lib/files/browser';

export interface DirectoryListingError {
  message: string;
  code?: string;
}

export interface UseDirectoryListingResult {
  listing: RemoteDirListing | null;
  loading: boolean;
  error: DirectoryListingError | null;
  /** List the same request again. */
  refresh: () => void;
  /** When the last request started (ms), for throttling focus refreshes. */
  lastRequestAt: () => number;
}

export function useDirectoryListing(profileId: string, path: string, sessionId?: string): UseDirectoryListingResult {
  const [listing, setListing] = useState<RemoteDirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DirectoryListingError | null>(null);
  const [generation, setGeneration] = useState(0);
  const sequence = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    const seq = ++sequence.current;
    startedAt.current = Date.now();
    setLoading(true);
    listRemoteDirectory({ profileId, path, ...(sessionId ? { sessionId } : {}) })
      .then((next) => {
        if (seq !== sequence.current) return;
        setListing(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (seq !== sequence.current) return;
        setError({ message: listingErrorMessage(e), code: listingErrorCode(e) });
      })
      .finally(() => {
        if (seq === sequence.current) setLoading(false);
      });
  }, [profileId, path, sessionId, generation]);

  // Nothing answers once the browser is gone.
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  const lastRequestAt = useCallback(() => startedAt.current, []);
  return { listing, loading, error, refresh, lastRequestAt };
}
