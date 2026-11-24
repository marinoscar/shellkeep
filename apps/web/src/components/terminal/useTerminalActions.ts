import { useCallback, useState } from 'react';
import type { TerminalViewHandle } from './TerminalView';
import type { CreateSessionData, TerminalSession } from '../../types';
import { createSession, downloadSessionHistory } from '../../services/terminal-api';
import { storageErrorMessage, uploadTerminalFile } from '../../services/storage';

/** A message for the workspace's snackbar. */
export interface TerminalActionNotice {
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
}

export interface UseTerminalActionsOptions {
  /** The pane the actions act on (the focused one), or `null` when none is mounted. */
  getView: () => TerminalViewHandle | null;
  /** The session shown in that pane (names the downloaded file). */
  session: TerminalSession | null;
  /** Show a message to the user. */
  notify: (notice: TerminalActionNotice) => void;
  /** A session was created from the workspace: open it. */
  onSessionCreated: (session: TerminalSession) => void;
}

export interface TerminalActions {
  /** Copy the selection, or the whole local buffer when nothing is selected. */
  copyAll: () => void;
  /** Paste the clipboard: text is typed, an image is uploaded and its URL typed. */
  paste: () => Promise<void>;
  /** Download the session's full tmux history, or the local buffer when that fails. */
  downloadHistory: () => Promise<void>;
  /** A history download is in flight. */
  isDownloading: boolean;
  /** Upload a file to object storage and type its signed URL at the prompt. */
  uploadFile: (file: File) => Promise<void>;
  /** An upload is in flight. */
  isUploading: boolean;
  /** Create a session and open it in the workspace. */
  createNewSession: (data: CreateSessionData) => Promise<void>;
}

/**
 * The text of the pane's local xterm buffer (trailing blank lines trimmed).
 * Exported for tests.
 */
export function readTerminalText(view: TerminalViewHandle | null): string {
  const terminal = view?.getTerminal();
  if (!terminal) return '';
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.join('\n');
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function historyFilename(session: TerminalSession | null): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `${session?.name || 'terminal'}-${stamp}.txt`;
}

/**
 * The terminal toolbar's actions, shared by every surface that shows them (the
 * desktop toolbar, the phone overflow menu). Each acts on the pane `getView`
 * returns, so a split workspace acts on the focused pane. Terminal bytes are
 * only ever written to the user's clipboard or a file they download, never
 * logged or sent anywhere else.
 */
export function useTerminalActions({
  getView,
  session,
  notify,
  onSessionCreated,
}: UseTerminalActionsOptions): TerminalActions {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const copyAll = useCallback(() => {
    const view = getView();
    const terminal = view?.getTerminal();
    const selection = terminal?.hasSelection() ? terminal.getSelection() : '';
    const text = selection || readTerminalText(view);
    if (text) {
      void navigator.clipboard.writeText(text);
    }
  }, [getView]);

  const typeIntoPane = useCallback(
    (text: string) => {
      const view = getView();
      view?.sendInput(text);
      view?.focus();
    },
    [getView],
  );

  const paste = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          if (text) {
            typeIntoPane(text);
            return;
          }
        }
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          notify({ message: 'Uploading image...', severity: 'info' });
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          const url = await uploadTerminalFile(blob, `clipboard-${Date.now()}.${ext}`);
          typeIntoPane(url);
          notify({ message: 'Image uploaded and URL pasted', severity: 'success' });
          return;
        }
      }
      notify({ message: 'Only text and images can be pasted', severity: 'warning' });
    } catch (err) {
      notify({ message: storageErrorMessage(err, 'Failed to paste from clipboard'), severity: 'error' });
    }
  }, [notify, typeIntoPane]);

  const downloadHistory = useCallback(async () => {
    if (!session) return;
    setIsDownloading(true);
    try {
      const blob = await downloadSessionHistory(session.id);
      saveBlob(blob, historyFilename(session));
    } catch {
      // The full tmux history is unavailable: fall back to the local buffer.
      const text = readTerminalText(getView());
      if (text) {
        saveBlob(new Blob([text], { type: 'text/plain' }), historyFilename(session));
      }
      notify({ message: 'Full history unavailable, downloaded local buffer', severity: 'warning' });
    } finally {
      setIsDownloading(false);
    }
  }, [session, getView, notify]);

  const uploadFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      notify({ message: `Uploading ${file.name}...`, severity: 'info' });
      try {
        const url = await uploadTerminalFile(file, file.name);
        // The URL is typed at the prompt, never followed by Enter.
        typeIntoPane(url);
        notify({ message: 'File uploaded and its link typed at the prompt', severity: 'success' });
      } catch (err) {
        notify({ message: storageErrorMessage(err, 'Failed to upload the file'), severity: 'error' });
      } finally {
        setIsUploading(false);
      }
    },
    [notify, typeIntoPane],
  );

  const createNewSession = useCallback(
    async (data: CreateSessionData) => {
      const created = await createSession(data);
      onSessionCreated(created);
    },
    [onSessionCreated],
  );

  return {
    copyAll,
    paste,
    downloadHistory,
    isDownloading,
    uploadFile,
    isUploading,
    createNewSession,
  };
}
