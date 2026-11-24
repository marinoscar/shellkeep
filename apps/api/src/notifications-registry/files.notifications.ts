// =============================================================================
// The folder archive events (issue #158)
// =============================================================================
//
// `files.archive_ready` and `files.archive_failed`: the requester's `files.archive` job finished. In-app and
// push only (no email template): the person is looking at the file browser. Sent by the handler AFTER the
// row's final write committed. KEYS, CHANNEL IDS AND TEMPLATE NAMES ARE PERSISTED: never rename one.
//
// NEVER IN A PAYLOAD: file content, a credential or a host name. The folder is named by its last path
// segment and the server by its profile name; the link is root-relative.
// =============================================================================

import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const FILES_ARCHIVE_READY_EVENT = 'files.archive_ready';
export const FILES_ARCHIVE_FAILED_EVENT = 'files.archive_failed';

export interface FileArchiveNotificationData {
  folderName: string;
  serverName: string;
  /** Present on `files.archive_ready`. */
  sizeBytes?: number;
  /** Present on `files.archive_failed`: the reason shown to the person (no secret, no file content). */
  reason?: string;
  /** Root-relative. */
  link: string;
}

export const FILE_ARCHIVES_PATH = '/servers';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

export function fileArchiveReadyBrowserTemplate(data: FileArchiveNotificationData) {
  const size = typeof data.sizeBytes === 'number' ? ` (${formatBytes(data.sizeBytes)})` : '';
  return {
    title: 'Your folder archive is ready',
    body: `"${data.folderName}" on ${data.serverName}${size} can be downloaded for 24 hours.`,
    link: data.link,
  };
}

export function fileArchiveFailedBrowserTemplate(data: FileArchiveNotificationData) {
  return {
    title: 'A folder archive failed',
    body: `"${data.folderName}" on ${data.serverName}: ${data.reason ?? 'the archive could not be built.'}`,
    link: data.link,
  };
}

export const FILES_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: FILES_ARCHIVE_READY_EVENT,
      label: 'Folder archive ready',
      description: 'Sent when a folder archive you requested from the file browser is ready to download.',
      channels: ['browser', 'push'],
      defaultEnabled: true,
    },
    browserTemplate: fileArchiveReadyBrowserTemplate,
  },
  {
    event: {
      key: FILES_ARCHIVE_FAILED_EVENT,
      label: 'Folder archive failed',
      description: 'Sent when a folder archive you requested from the file browser could not be built.',
      channels: ['browser', 'push'],
      defaultEnabled: true,
    },
    browserTemplate: fileArchiveFailedBrowserTemplate,
  },
];
