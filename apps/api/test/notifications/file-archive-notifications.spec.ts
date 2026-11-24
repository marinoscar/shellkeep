import {
  FILES_ARCHIVE_FAILED_EVENT,
  FILES_ARCHIVE_READY_EVENT,
  FILES_NOTIFICATIONS,
  fileArchiveFailedBrowserTemplate,
  fileArchiveReadyBrowserTemplate,
} from '../../src/notifications-registry/files.notifications';

describe('folder archive notifications (#158)', () => {
  it('declares two in-app and push events, on by default, never mandatory, with no email template', () => {
    expect(FILES_NOTIFICATIONS.map((n) => n.event.key)).toEqual(['files.archive_ready', 'files.archive_failed']);
    for (const n of FILES_NOTIFICATIONS) {
      expect(n.event.channels).toEqual(['browser', 'push']);
      expect(n.event.defaultEnabled).toBe(true);
      expect((n.event as { mandatory?: boolean }).mandatory).toBeFalsy();
      expect(n.emailTemplate).toBeUndefined();
      expect(n.browserTemplate).toBeDefined();
    }
    expect(FILES_ARCHIVE_READY_EVENT).toBe('files.archive_ready');
    expect(FILES_ARCHIVE_FAILED_EVENT).toBe('files.archive_failed');
  });

  it('renders the ready text with the size and a root-relative link', () => {
    const out = fileArchiveReadyBrowserTemplate({ folderName: 'logs', serverName: 'Server A', sizeBytes: 5 * 1024 * 1024, link: '/servers' });
    expect(out).toEqual({ title: 'Your folder archive is ready', body: '"logs" on Server A (5.0 MB) can be downloaded for 24 hours.', link: '/servers' });
  });

  it('renders the failure reason', () => {
    const out = fileArchiveFailedBrowserTemplate({ folderName: 'logs', serverName: 'Server A', reason: 'tar exited with status 2', link: '/servers' });
    expect(out.body).toBe('"logs" on Server A: tar exited with status 2');
    expect(out.link).toBe('/servers');
  });
});
