# Files over SFTP

Epic #151, API issue #153. Find, read and download a file on a server from the browser. Code: `apps/api/src/files/`.

## Access

The same as opening a terminal on that server: `sessions:write` (what the WebSocket gateway requires) plus `ServerProfilesService.getDecryptedProfile(..., 'connect')`, which runs `AccessPolicy` `connect` (owner, or a share that allows connecting) on every request. There is no `files:*` permission. A profile or session the caller may not use is a 404.

## Transport

SFTP over `SshConnectionFactory` (host key verified before any credential). One connection and one SFTP session per request, closed in `finally`, with a deadline (`sftpTimeoutSeconds`; idle time for a download). A server with the SFTP subsystem disabled answers `SFTP_UNAVAILABLE` (502); there is no fallback to `cat` over exec. A path goes to SFTP calls only: NUL bytes are refused, `..` is resolved lexically, nothing reaches a shell.

## Routes (under `/api`)

| Route | Answer |
|---|---|
| `GET server-profiles/:id/files?path=` | `{ path, entries[], truncated }`; entry: `name`, `type` (`file` `dir` `symlink` `other`), `size`, `mtime`, `mode` (`0644`), `symlinkTarget`, `targetType`; directories first (a link to a directory counts); at most 5000 entries |
| `GET .../files/stat?path=` | the entry, plus `path`, `mime` (from the extension) and `isText` (first 8 KB) |
| `GET .../files/content?path=&offset=&length=` | `{ text, offset, length, size, eof }` |
| `POST .../files/download-token` `{ path }` | `{ token, expiresAt }` |
| `GET files/download/:token` | the bytes: `Content-Length`, `Content-Disposition: attachment; filename*=UTF-8''...`, never buffered |

`sessionId` (optional, on list, stat, content and the token body) resolves a relative path against that session's tmux `#{pane_current_path}` (`SessionHistoryService.currentPath`), and `~` against the login home (`realpath('.')`). The session must be the caller's and on that profile. Without it a relative path is relative to home.

## Text reads

`length` is clamped to `fullViewMaxBytes`; a file above `pagedViewMaxBytes` is refused (`FILE_TOO_LARGE`, download only). A NUL byte or invalid UTF-8 in the first 8 KB of the file, or invalid UTF-8 in the window, is `FILE_IS_BINARY` (415). A window never splits a character: it drops an incomplete trailing character and skips the tail bytes of one that began before it. `offset` in the answer is where the text really starts; continue at `offset + length`.

## Downloads

The token is random (256 bits), stored only as a SHA-256 in memory (the API is a single instance), single use, valid 60 seconds, bound to user, organization, profile, path and size. The download route is public by token (a browser's native download sends no `Authorization`); on redemption the token user's current principal is resolved (active, still in the organization), `sessions:write` is required and the connect rule is checked again, the size must still match (`FILE_CHANGED`), and the file must be within `downloadMaxBytes`. A client abort destroys the SFTP stream and closes the connection. Every download is an audit event `server_profile.file_download` (`path`, `size`, `hostname`).

## Settings (`files`, admin)

`fullViewMaxBytes` 2 MB, `pagedViewMaxBytes` 200 MB, `downloadMaxBytes` 2 GB, `uploadMaxBytes` 100 MB (for #157), `sftpTimeoutSeconds` 30, and per user `contentRequestsPerMinute` 120, `downloadsPerMinute` 20, `maxConcurrentDownloads` 3. Read on every request.

## Error codes

`FILE_PATH_INVALID` 400, `FILE_RANGE_INVALID` 400, `FILE_NOT_A_FILE` 400, `FILE_NOT_A_DIRECTORY` 400, `FILE_NOT_FOUND` 404, `FILE_DOWNLOAD_NOT_FOUND` 404, `FILE_PERMISSION_DENIED` 403, `FILE_CHANGED` 409, `FILE_TOO_LARGE` 413, `FILE_IS_BINARY` 415, `FILES_RATE_LIMITED` 429, `SFTP_UNAVAILABLE` 502, `SFTP_FAILED` 502, `SFTP_TIMEOUT` 504, plus the host-key 409s of the other SSH routes.

## Never

File content is never logged, traced or sent to AI. Spans carry the profile id, never the path.
