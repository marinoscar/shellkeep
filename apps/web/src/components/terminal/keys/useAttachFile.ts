/**
 * The `attach-file` key (issue #167, epic #171): pick a file and upload it into
 * the session's current working directory, through the same files API the file
 * browser uploads with (`uploadRemoteFile`, #157). The directory is resolved
 * first (`stat .` with the session), so the upload goes to an absolute folder
 * and the notice can name it. An existing file is never replaced from here: the
 * user is told to use the Files panel, which asks.
 *
 * The workspace offers the key only to a holder of `sessions:write` (the files
 * API's rule) with a server profile for the active session.
 */
import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { RemoteUploadError, statRemoteFile, uploadRemoteFile } from '../../../services/files-api';
import type { TerminalActionNotice } from '../useTerminalActions';

export interface UseAttachFileOptions {
  /** The active session's server profile; no upload without one. */
  profileId: string | undefined;
  /** The active session: its working directory is the target. */
  sessionId: string | null;
  notify: (notice: TerminalActionNotice) => void;
}

function failure(error: unknown): string {
  if (error instanceof RemoteUploadError) {
    if (error.code === 'FILE_TOO_LARGE') return "The file is larger than the server's upload limit";
    return error.message || 'The upload failed';
  }
  return error instanceof Error && error.message ? error.message : 'The upload failed';
}

export function useAttachFile({ profileId, sessionId, notify }: UseAttachFileOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /** Opens the file picker. */
  const pick = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  /** Uploads one file to the session's working directory. */
  const upload = useCallback(
    async (file: File) => {
      if (!profileId || !sessionId) return;
      setUploading(true);
      notify({ message: `Uploading ${file.name}...`, severity: 'info' });
      let dir = '';
      try {
        dir = (await statRemoteFile({ profileId, path: '.', sessionId })).path;
        await uploadRemoteFile({ profileId, dir, name: file.name, file, sessionId });
        notify({ message: `Uploaded ${file.name} to ${dir}`, severity: 'success' });
      } catch (error) {
        if (error instanceof RemoteUploadError && error.code === 'FILE_EXISTS') {
          notify({
            message: `${file.name} already exists in ${dir}. Use the Files panel to replace it.`,
            severity: 'warning',
          });
        } else {
          notify({ message: `Could not upload ${file.name}: ${failure(error)}`, severity: 'error' });
        }
      } finally {
        setUploading(false);
      }
    },
    [profileId, sessionId, notify],
  );

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void upload(file);
    },
    [upload],
  );

  return { inputRef, pick, upload, onInputChange, uploading };
}
