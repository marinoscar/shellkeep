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

// ---------------------------------------------------------------------------
// Uploads (issue #157)
// ---------------------------------------------------------------------------

/** `POST /server-profiles/:id/files/upload`: the file as it now exists on the server. */
export interface UploadedRemoteFile {
  path: string;
  name: string;
  size: number;
  /** An existing file was replaced. */
  overwritten: boolean;
}

/** Bytes sent so far (the request body, which is the file's bytes). */
export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadRemoteFileRequest {
  profileId: string;
  /** The target folder (absolute: the folder the browser lists). */
  dir: string;
  /** The file name on the server. */
  name: string;
  file: Blob;
  /** Replace an existing file of that name. Default false: an existing file is a 409 `FILE_EXISTS`. */
  overwrite?: boolean;
  sessionId?: string;
  onProgress?: (progress: UploadProgress) => void;
  /** Aborting cancels the request; the API removes the partial file. */
  signal?: AbortSignal;
}

/** A refused or failed upload, with the API's code (`FILE_EXISTS`, `FILE_TOO_LARGE`, ...) and details. */
export class RemoteUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'RemoteUploadError';
  }
}

/** The existing file's facts a `FILE_EXISTS` answer carries (all optional: it is a hint for the prompt). */
export interface ExistingFileDetails {
  size?: number;
  mtime?: string;
}

export function isUploadCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function sendUpload(request: UploadRemoteFileRequest, token: string | null): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    if (request.signal?.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
    const xhr = new XMLHttpRequest();
    const url =
      `${API_BASE_URL}${base(request.profileId)}/upload?` +
      query({ path: request.dir, name: request.name, overwrite: request.overwrite ? 'true' : 'false', sessionId: request.sessionId });
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      request.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : request.file.size });
    };
    const onAbort = () => {
      xhr.abort();
      // Do not wait for the browser's own abort event: Cancel answers at once.
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => request.signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => {
      done();
      reject(new RemoteUploadError('The connection was lost during the upload', 0, undefined, undefined));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    xhr.send(request.file);
  });
}

/**
 * Streams one file to a folder on the server (the file's bytes are the body,
 * never a multipart form). Progress is the browser's upload progress. A 401 is
 * retried once after a token refresh, like every other call.
 */
export async function uploadRemoteFile(request: UploadRemoteFileRequest): Promise<UploadedRemoteFile> {
  let result = await sendUpload(request, api.getAccessToken());
  if (result.status === 401 && (await api.refreshToken())) {
    request.onProgress?.({ loaded: 0, total: request.file.size });
    result = await sendUpload(request, api.getAccessToken());
  }
  const body = result.body as { data?: UploadedRemoteFile; code?: string; message?: string; details?: Record<string, unknown> } | undefined;
  if (result.status >= 200 && result.status < 300 && body?.data) return body.data;
  throw new RemoteUploadError(
    body?.message || `The upload failed (${result.status})`,
    result.status,
    body?.code,
    body?.details,
  );
}
