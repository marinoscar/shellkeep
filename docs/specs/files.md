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

`fullViewMaxBytes` 2 MB, `pagedViewMaxBytes` 200 MB, `downloadMaxBytes` 2 GB, `uploadMaxBytes` 100 MB (for #157), `sftpTimeoutSeconds` 30, and per user `contentRequestsPerMinute` 120, `downloadsPerMinute` 20, `maxConcurrentDownloads` 3. Read on every request. The sizes must satisfy `fullViewMaxBytes <= pagedViewMaxBytes <= downloadMaxBytes`: the stored and PUT schemas carry the rule, and the platform validates a PATCH's merged value against the stored schema, so all three paths answer 400 naming the field out of order.

## Error codes

`FILE_PATH_INVALID` 400, `FILE_RANGE_INVALID` 400, `FILE_NOT_A_FILE` 400, `FILE_NOT_A_DIRECTORY` 400, `FILE_NOT_FOUND` 404, `FILE_DOWNLOAD_NOT_FOUND` 404, `FILE_PERMISSION_DENIED` 403, `FILE_CHANGED` 409, `FILE_TOO_LARGE` 413, `FILE_IS_BINARY` 415, `FILES_RATE_LIMITED` 429, `SFTP_UNAVAILABLE` 502, `SFTP_FAILED` 502, `SFTP_TIMEOUT` 504, plus the host-key 409s of the other SSH routes.

## Never

File content is never logged, traced or sent to AI. Spans carry the profile id, never the path.

## Viewer

Issue #154. The web client of the routes above. Code: `apps/web/src/components/files/viewer/`, `apps/web/src/pages/FileViewerPage.tsx`, `apps/web/src/lib/files/viewer/`, `apps/web/src/services/files-api.ts`.

**Entry point.** `useOpenFile()` returns `openFile({ profileId, path, sessionId?, line? })` (`FileViewerProvider.tsx`). `path` is absolute, `~/...`, or relative to the session's working directory (else home); `line` is 1-based. With the provider mounted around the signed-in shell, `openFile` shows the viewer in a full-screen dialog over the current page, so a terminal keeps its connection. Without a provider it navigates to the deep link. The viewer code loads lazily, only when a file is opened.

**Deep link.** `/servers/:id/files/view?path=&sessionId=&line=` (`fileViewerPath`, `parseFileViewerSearch`), a full-bleed page under the `servers` destination. The route requires `sessions:write`, the permission the files API enforces; without it the user lands on Home. A link with no `path` shows an error.

**Limits come from the API's answers.** The `files` system settings need `system_settings:read`, which non-admins lack, so the viewer never reads them. `useFileDocument` decides from responses instead:

| Mode | When |
|---|---|
| Full | `stat` says `isText`, and the first `content` read (no `length`) returns `eof`: the whole file fits `fullViewMaxBytes`. |
| Paged | The first read is not `eof`. Its length is the window size; the viewer moves by offset (previous, next, head, tail, jump to `42%`, a byte offset or `12k`). |
| Download only | `FILE_TOO_LARGE` (above `pagedViewMaxBytes`), or an image above the preview size cap. |
| Binary | `isText` is false, or `FILE_IS_BINARY` from a file the `stat` sniff missed. |

Download-only and binary files get a card with a Download button.

**Languages.** The mode is picked from the file name only (`language.ts`: whole name, `.env` family, Dockerfile variants, nginx `*.conf` under an `nginx` directory, extension, a shell shebang, names containing `log` or `journal`). Modes: Markdown, JSON, YAML, XML, shell, INI, TOML, Dockerfile, nginx, environment, log, plain text. Each loads on demand (`languages.ts`); JSON uses `@codemirror/lang-json`, the others the stream modes of `@codemirror/legacy-modes`, and Markdown a small built-in mode. JSON can be pretty-printed with the parse error's line and column.

**`.env` masking.** For the `env` mode every non-empty value is replaced by a fixed-length mask (`maskEnv`), so neither the value nor its length shows. Comments stay. A Reveal values toggle shows the real text; it resets when another file opens.

**Logs.** A log has ANSI escapes stripped and error, warning and info words highlighted. Tail jumps to the end. Follow polls `stat` every 2.5 seconds (`FOLLOW_INTERVAL_MS`), skips ticks while the page is hidden, reads only the appended range, and shows the new tail if the file shrank or rotated. The followed buffer is bounded: whole lines are dropped from the start once it exceeds the window size (at least 64 KiB). Follow stops on an error and says why.

**Markdown preview.** `marked` renders, then DOMPurify sanitizes (`markdown.ts`). Raw HTML in the source is shown as text, never parsed. Images are dropped (a remote `<img>` would leak the viewer's address to any host the file names). `javascript:` URLs are stripped by the sanitizer. `img`, `style`, `form`, `input`, `button`, `iframe`, `object`, `embed`, `svg` and `math` are forbidden; links open in a new tab with `noopener noreferrer`.

**Images.** PNG, JPEG, GIF, WebP and SVG preview as an `<img>` (SVG is never inlined; "Show source" reads its markup as text). The `<img>` source is `files/download/:token`, so each preview spends one single-use download token and is audited as `server_profile.file_download`, like any download. It also counts against `downloadsPerMinute`.

**Dependencies** added to `apps/web`: `@codemirror/lang-json`, `@codemirror/legacy-modes`, `marked`, `dompurify`.
