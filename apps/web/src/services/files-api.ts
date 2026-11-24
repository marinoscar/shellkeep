import { api, API_BASE_URL } from './api';

// Remote files over SFTP (issue #153; the viewer is #154, epic #151). The
// routes live under the server profile; access is the terminal's. Wire shapes
// are declared here: the web never imports API source.

/** `GET /server-profiles/:id/files/stat`. */
export interface RemoteFileStat {
  name: string;
  /** The absolute path the API resolved. */
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtime: string | number | null;
  mode: string;
  symlinkTarget?: string | null;
  targetType?: 'file' | 'dir' | 'symlink' | 'other' | null;
  /** From the extension; `application/octet-stream` when unknown. */
  mime: string;
  /** From the first 8 KB (NUL bytes or invalid UTF-8 make it binary). */
  isText: boolean;
}

/** One entry of `GET /server-profiles/:id/files` (#153). */
export interface RemoteDirEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  /** ISO 8601. */
  mtime: string;
  /** Permission bits as octal, e.g. `0644`. */
  mode: string;
  /** A symlink's target, else `null`. */
  symlinkTarget: string | null;
  /** What a symlink resolves to (`null` when broken); `null` for a non-link. */
  targetType: 'file' | 'dir' | 'symlink' | 'other' | null;
}

/** `GET /server-profiles/:id/files`: a directory, directories first, then by name. */
export interface RemoteDirListing {
  /** The absolute path the API resolved (`.` with a session is its working directory). */
  path: string;
  entries: RemoteDirEntry[];
  /** The directory held more entries than the API lists. */
  truncated: boolean;
}

/** `GET /server-profiles/:id/files/content`: one window of a text file. */
export interface RemoteFileContent {
  text: string;
  /** Where the text really starts (a split character is skipped). */
  offset: number;
  /** Bytes the text covers; continue at `offset + length`. */
  length: number;
  size: number;
  eof: boolean;
}

/** `POST /server-profiles/:id/files/download-token`. */
export interface RemoteFileDownloadToken {
  token: string;
  expiresAt: string;
}

/** Which file: the server, the path, and the session a relative path resolves against. */
export interface RemoteFileRef {
  profileId: string;
  path: string;
  sessionId?: string;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

function base(profileId: string): string {
  return `/server-profiles/${encodeURIComponent(profileId)}/files`;
}

/** Lists a directory; `.` with `sessionId` is the session's working directory, `~` is home. */
export function listRemoteDirectory(ref: RemoteFileRef): Promise<RemoteDirListing> {
  return api.get<RemoteDirListing>(`${base(ref.profileId)}?${query({ path: ref.path, sessionId: ref.sessionId })}`);
}

export function statRemoteFile(ref: RemoteFileRef): Promise<RemoteFileStat> {
  return api.get<RemoteFileStat>(`${base(ref.profileId)}/stat?${query({ path: ref.path, sessionId: ref.sessionId })}`);
}

/** One window: `length` defaults to (and is capped at) the full-view limit. */
export function readRemoteFile(
  ref: RemoteFileRef,
  range: { offset?: number; length?: number } = {},
): Promise<RemoteFileContent> {
  return api.get<RemoteFileContent>(
    `${base(ref.profileId)}/content?${query({ path: ref.path, sessionId: ref.sessionId, offset: range.offset, length: range.length })}`,
  );
}

export function createDownloadToken(ref: RemoteFileRef): Promise<RemoteFileDownloadToken> {
  return api.post<RemoteFileDownloadToken>(`${base(ref.profileId)}/download-token`, {
    path: ref.path,
    ...(ref.sessionId ? { sessionId: ref.sessionId } : {}),
  });
}

/** The public, single-use URL a token redeems (same origin, no Authorization needed). */
export function downloadUrl(token: string): string {
  return `${API_BASE_URL}/files/download/${encodeURIComponent(token)}`;
}

/**
 * Downloads a file with the browser's native download (progress, save
 * dialog): issues a token, then clicks an `<a download>` at its URL.
 */
export async function downloadRemoteFile(ref: RemoteFileRef): Promise<void> {
  const { token } = await createDownloadToken(ref);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl(token);
  anchor.download = '';
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}
