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
| `POST .../files/upload?path=&name=&overwrite=` | `{ path, name, size, overwritten }` (201); the body is the raw file, see [Upload](#upload) |

`sessionId` (optional, on list, stat, content and the token body) resolves a relative path against that session's tmux `#{pane_current_path}` (`SessionHistoryService.currentPath`), and `~` against the login home (`realpath('.')`). The session must be the caller's and on that profile. Without it a relative path is relative to home.

## Text reads

`length` is clamped to `fullViewMaxBytes`; a file above `pagedViewMaxBytes` is refused (`FILE_TOO_LARGE`, download only). A NUL byte or invalid UTF-8 in the first 8 KB of the file, or invalid UTF-8 in the window, is `FILE_IS_BINARY` (415). A window never splits a character: it drops an incomplete trailing character and skips the tail bytes of one that began before it. `offset` in the answer is where the text really starts; continue at `offset + length`.

## Downloads

The token is random (256 bits), stored only as a SHA-256 in memory (the API is a single instance), single use, valid 60 seconds, bound to user, organization, profile, path and size. The download route is public by token (a browser's native download sends no `Authorization`); on redemption the token user's current principal is resolved (active, still in the organization), `sessions:write` is required and the connect rule is checked again, the size must still match (`FILE_CHANGED`), and the file must be within `downloadMaxBytes`. A client abort destroys the SFTP stream and closes the connection. Every download is an audit event `server_profile.file_download` (`path`, `size`, `hostname`).

## Settings (`files`, admin)

`fullViewMaxBytes` 2 MB, `pagedViewMaxBytes` 200 MB, `downloadMaxBytes` 2 GB, `uploadMaxBytes` 100 MB (uploads, [Upload](#upload)), `sftpTimeoutSeconds` 30, and per user `contentRequestsPerMinute` 120, `downloadsPerMinute` 20, `maxConcurrentDownloads` 3. Read on every request. The sizes must satisfy `fullViewMaxBytes <= pagedViewMaxBytes <= downloadMaxBytes`: the stored and PUT schemas carry the rule, and the platform validates a PATCH's merged value against the stored schema, so all three paths answer 400 naming the field out of order.

## Error codes

`FILE_PATH_INVALID` 400, `FILE_RANGE_INVALID` 400, `FILE_NOT_A_FILE` 400, `FILE_NOT_A_DIRECTORY` 400, `FILE_NAME_INVALID` 400, `FILE_NOT_FOUND` 404, `FILE_DOWNLOAD_NOT_FOUND` 404, `FILE_PERMISSION_DENIED` 403, `FILE_EXISTS` 409, `FILE_CHANGED` 409, `FILE_TOO_LARGE` 413, `FILE_IS_BINARY` 415, `FILES_RATE_LIMITED` 429, `SFTP_UNAVAILABLE` 502, `SFTP_FAILED` 502, `SFTP_TIMEOUT` 504, plus the host-key 409s of the other SSH routes.

## Never

File content is never logged, traced or sent to AI. Spans carry the profile id, never the path.

## Upload

Issue #157. `POST server-profiles/:id/files/upload?path=<target folder>&name=<file name>&overwrite=false[&sessionId=]`, body `application/octet-stream` (the file's bytes; not multipart). Code: `FilesService.upload`, `SftpSession` write calls, `upload-body-parser.ts` (the Fastify parser that hands the request through unread, for this route only; registered in `main.ts`), `upload-name.ts`.

**Streaming.** The request body is read as a stream and written with SFTP WRITE requests (up to 16 in flight, so speed is not one round trip per chunk) to a temporary file in the target folder named `.<name>.shellkeep-upload-<12 hex>`, opened exclusively (`wx`). When the body ends the handle is closed and the temp file is renamed onto `name`; a reader never sees a half-written file, and memory use is bounded by the write window, not the file. The SFTP connection has an idle deadline (`sftpTimeoutSeconds` without a chunk or an acknowledgement), not a total one, so a slow, long upload is fine.

**Cap.** `uploadMaxBytes` is read on every request. `Content-Length`, when sent, is checked before any connection is opened; the bytes are also counted while streaming. Over the cap the upload stops and the temp file is removed: `FILE_TOO_LARGE` (413), nothing left behind.

**Existing target.** Without `overwrite=true` an existing file (or link) of that name is `FILE_EXISTS` (409) with `details` `{ name, path, size, mtime }`, so the UI can ask. The check is repeated at rename time (the standard SFTP RENAME never replaces), so a file created while streaming is the same 409. With `overwrite=true` the temp file replaces it: atomically with OpenSSH's `posix-rename` extension when the server offers it, else by removing the target and then renaming (a short window with no file). A folder with that name is `FILE_NOT_A_FILE` (400) either way.

**Cleanup.** Any error, a client abort, a refused cap or a timeout closes the handle and removes the temp file (best effort: if the SSH connection itself is gone the temp file stays; it is dot-named and carries a recognisable suffix).

**Name.** `name` is one path segment: not empty, not `.` or `..`, no `/`, NUL or other control characters, at most 200 UTF-8 bytes (`FILE_NAME_INVALID`, 400). `path` goes only to SFTP calls (resolved like every files path: absolute, `~`, or relative to the session's directory or home).

**Access and limits.** The same as the other routes: `sessions:write` plus the connect rule, a 404 otherwise, checked before the media type, name or size are looked at. Uploads count against the per-user `downloadsPerMinute` (a separate counter) and `maxConcurrentDownloads` (a separate slot count), so there is no new setting. A body that is not `application/octet-stream` is 415.

**Audit.** Every completed upload is `server_profile.file_upload` (`path`, `size`, `hostname`). File content is never logged, traced or audited, and spans carry the profile id only.

**Web.** See [File browser](#file-browser): the Upload button and drag-and-drop.

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

**From the terminal.** Paths in terminal output open this viewer, download through a token, or copy, after a lazy `stat`: [terminal.md section 5.6](terminal.md#56-file-links-in-terminal-output).

## File browser

Issue #156. Code: `apps/web/src/components/files/browser/` (`FileBrowser`, `useDirectoryListing`), `apps/web/src/lib/files/browser.ts`, `apps/web/src/components/terminal/files/FileBrowserPanel.tsx`. It lists folders with `GET /server-profiles/:id/files` and opens files with `openFile`.

**Where.** In the terminal workspace a Files toolbar button toggles a panel for the active session's server: docked right of the panes on `md` and up, a bottom sheet below, decided by `useTerminalLayout` like the AI panel. The Files and AI panels take turns in the side area (opening one closes the other) rather than sharing it with tabs: each keeps its own width, the terminal keeps enough room on a laptop, and on a phone both are bottom sheets, which cannot stack anyway. On the Servers page the detail drawer has a Files tab next to Details, the same component without a session, rooted at `~`. Both are shown only with `sessions:write` and, on the server page, connect rights on the profile: the files API's own rule. The API stays the gate.

**Contents.** Breadcrumbs, an editable path (Enter goes; a relative path is taken from the current folder), Up, Refresh, hidden files (dotfiles hidden by default), a name filter, and sort by name, size or modified time, folders always first. Each row shows a type icon, a human-readable size and a relative modified time; a symlink shows its target and acts as what it points to.

**Follow terminal directory.** With a session the browser lists `.` and `sessionId`, which the API resolves against the pane's working directory (tmux `#{pane_current_path}`). It is on by default, refreshes when the window or the browser gains focus (at most every 2 seconds) and on Refresh, and turns off as soon as the user navigates.

**Actions.** Clicking a file opens the viewer (`openFile`, with the session when there is one); clicking a folder navigates. The row menu (kebab, right-click, the context-menu key or Shift+F10) offers Open, Download (a token, then the browser's native download) and Copy path. A folder row also offers **Download as archive** ([Folder archives](#folder-archives)). Keyboard: arrows, Home and End move between rows (one tab stop), Enter opens, Backspace goes up. Each row is named by its name, type, size and modified time.

**Guardrails.** The size badges are hints from the default caps (`DEFAULT_FILES_SYSTEM_SETTINGS`, 2 MB and 200 MB), since non-admins cannot read the `files` settings: "Large" above the full-view cap (the viewer pages it), "Download only" above the paged cap. The viewer asks the API for the real answer. Listing errors are explained by code: `SFTP_UNAVAILABLE`, `FILE_PERMISSION_DENIED`, `FILE_NOT_FOUND`, `FILE_NOT_A_DIRECTORY`, timeouts and rate limits, each with Retry. A listing the API truncated (5000 entries) says so; the browser renders 500 rows at a time.

**From the terminal.** The file link menu's "Show in file browser" ([terminal.md section 5.6](terminal.md#56-file-links-in-terminal-output)) opens the panel at the file's folder with the file selected (a folder link opens the folder), switching first to a pane on that link's server. Follow is off for a reveal; the toolbar button opens the panel following the terminal again.

**Upload.** Issue #157. An Upload button (toolbar, next to Refresh, opens the system file picker: several files, and on a phone the Files app or camera roll) and drag-and-drop onto the browser send files into the folder listed (`useFileUploads`, `UploadPanel`, `uploadRemoteFile` in `services/files-api.ts`). Only holders of `sessions:write` see it; it is disabled while a folder is loading or failed. Files queue and send one or two at a time over `XMLHttpRequest` (for upload progress) with a per-file progress bar and a Cancel button (an `AbortController`; the API removes the partial file). A file over the 100 MB default cap (`DEFAULT_FILES_SYSTEM_SETTINGS.uploadMaxBytes`; the real cap is the API's) is refused with a message before anything is sent. A 409 opens a Replace or Skip dialog with "Apply to all" for the rest of the batch. When the queue drains the listing refreshes. A dropped folder is skipped with a notice. Accessibility: the button is labelled, the list is described by a hint that files can be dropped, a status region names the drop target while dragging and announces each file's start, completion, skip, cancel and failure, and each progress bar is a labelled `progressbar`. No breakpoint is read.

## Folder archives

Issue #158. A folder is downloaded as a `tar.gz` built by a queue job (it outlives the request, and it holds an SSH connection). Code: `apps/api/src/files/archive/`.

**Routes.** `POST server-profiles/:id/files/archive` `{ path, sessionId? }` answers 202 `{ archiveId, jobId, status: 'pending' }`; `GET files/archives/:archiveId` answers `{ archiveId, serverProfileId, path, status, sizeBytes, warning, errorCode, errorMessage, createdAt, finishedAt, expiresAt }` (`status`: `pending`, `running`, `ready`, `failed`, or `expired` once `expiresAt` has passed); `GET files/archives/:archiveId/download` answers `{ url, filename, expiresAt }`, a presigned URL valid 15 minutes with `Content-Disposition: attachment` (409 `FILE_ARCHIVE_NOT_READY` until the archive is ready). All need `sessions:write` plus the connect rule on the server. The archive is the requester's: another user's id, a server the caller can no longer connect to, a deleted server, an expired or unknown archive are all the same 404. The request resolves the path (as every files path), checks over SFTP that it is a directory (`FILE_NOT_A_DIRECTORY`), counts against `downloadsPerMinute`, and is refused with `FILES_RATE_LIMITED` while the user already has `maxConcurrentDownloads` archives building.

**The record.** A `file_archives` row (org table, forced row-level security, `user_id` the requester) holds the status the browser polls, the size, a warning, the failure code and message, and `expires_at`. A `storage_objects` row was rejected for this: the storage slice has no expiry, its sweep and objects API own `pending` rows, and the archive also needs a job status, a failure reason and the server. The blob is a plain object at `file-archives/<orgId>/<archiveId>/archive.tar.gz` under a registered org-scoped prefix, so the slice's purge of an organization reaches it.

**The job `files.archive`.** Payload `{ archiveId, orgId, userId, serverProfileId, path }`: ids and the resolved path, no secret. Server-only (no `nodeResultSchema`: it holds an SSH connection), `profile: { maxRuntimeMs: 30 min, maxAttempts: 1 }`. 30 minutes is a 2 GB archive at 2 MB/s with margin, and the handler fails with a reason a minute earlier (`ARCHIVE_TIMEOUT`) instead of the lease reaper doing it silently; one attempt, because a retry would stream the same folder again for a result the person already saw fail (they can ask again). It re-checks access for the requester as they are now, connects through `SshConnectionFactory` (host key verified first; `ARCHIVE_HOST_KEY` on a refusal) and runs one exec, `tar -czf - -C '<parent>' -- '<base>'`: the parent and the base name are single-quoted with `shellQuote` (a quote in a name is `'\''`), `--` ends the options, and no other user string is interpolated (`tar-command.spec.ts` runs hostile names through a real shell). stdout goes through a byte counter straight into `StorageProvider.upload` (never buffered beyond the upload's part size, no temp file); the counter fails the stream at `downloadMaxBytes` (`ARCHIVE_TOO_LARGE`: the upload aborts, the remote tar is closed, the object is deleted). The job awaits BOTH the upload and tar's exit status: 0 is success, **1 is success with a warning** ("a file changed as we read it"), 2 or more (or a signal, or no status) fails `ARCHIVE_TAR_FAILED` with tar's first stderr line (in the row only, never in a log) and deletes the object. Failure codes: `ARCHIVE_TOO_LARGE`, `ARCHIVE_TAR_FAILED`, `ARCHIVE_ACCESS_LOST`, `ARCHIVE_HOST_KEY`, `ARCHIVE_CONNECT_FAILED`, `ARCHIVE_TIMEOUT`, `ARCHIVE_STORAGE_FAILED`, `ARCHIVE_FAILED`. A row that is gone, ready or failed is a no-op (at-least-once delivery).

**Expiry.** An archive lives 24 hours from the request (a ready or failed one is renewed to 24 hours from when it settled). `FileArchiveTask` (hourly `@Cron`, enqueue-only) queues the system job `files.archive.purge`, which selects expired rows across organizations (bypass client, reason `files-archive-purge`), deletes their objects and then the rows; a failed object delete keeps the row for the next pass. A user's purge (`servers.user_data.purge`) deletes their archive objects before the rows. **Orphan sweep.** Deleting an account or a factory reset removes `file_archives` rows (cascade) without their objects, so after the expiry pass `files.archive.purge` also deletes every object under `file-archives/` whose archive id (the third key segment) has no row. `StorageProvider` has no list-by-prefix call, so the keys come from the active driver's `listKeys` (`ArchiveObjectLister`, the way `npm run storage:purge` lists); a driver without `listKeys`, or no storage configured, skips the sweep with a log line. A listing carries no age, so the upload writes a `created-at` metadata and the sweep leaves any object younger than one hour alone (an object with no such metadata counts as old; a build always has its row first, so this is a second guard). Each run examines at most 2000 keys, in batches of 200 checked against the table, and resumes after the last key it saw on the next run (in memory: the API is a single instance), wrapping to the start when the listing ends, so a large backlog spreads over runs. A failing listing never fails the expiry pass.

**Notification and audit.** `files.archive_ready` and `files.archive_failed` (in-app and push, on by default) are sent after the row's final write, naming the folder, the server profile and the size or reason, never a host or content. Audit: `server_profile.folder_archive` when the archive is ready (`path`, `size`, `hostname`) and `server_profile.folder_archive_download` when a link is issued (`archiveId`, `path`, `size`).

**Limits.** The remote login shell must be POSIX-compatible: the single-quote escaping of the path (`'\''`) is not understood by csh-style shells, so a folder whose name contains a single quote cannot be archived on such a server (the job fails with `ARCHIVE_TAR_FAILED`).

**Web.** See [File browser](#file-browser): the folder row's **Download as archive** menu item.

## CLI

Issue #159. `shellkeep files ls|cat|get|put|archive <server> ...` over the routes above, with the device-flow personal access token ([README](../../apps/cli/README.md#files) is the usage source of truth). Code: `apps/cli/src/commands/files-*.ts`. `<server>` is a profile name or id. `cat` reads one window at a time (`--tail` walks backwards, overlapping each window by 4 bytes so a character split between two windows is not lost); `get` and `archive` stream to a `.part` file and rename it; `put` streams the file with its `Content-Length`; `archive` polls the status route and downloads the presigned URL without the bearer token. A binary file or `FILE_TOO_LARGE` on `cat` points to `get`; a 409 `FILE_EXISTS` on `put` points to `--overwrite`.
