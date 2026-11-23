// =============================================================================
// The terminal events (issue #51)
// =============================================================================
//
// `terminal.session_reaped`: the owner's idle sessions were closed by the reaper
// (`terminal.session.reap`, #49). One notification per owner per pass, listing the
// sessions. KEYS, CHANNEL IDS AND TEMPLATE NAMES ARE PERSISTED: never rename one.
//
// CHANNELS. The event declares in-app, email and push so the preferences matrix
// offers all three. The platform has ONE `defaultEnabled` per event, not one per
// channel, so the intended default (in-app on, email off, push off) cannot be
// declared: all three start on, and a user switches email or push off. Push only
// reaches a browser that subscribed, and email only when a transport is configured,
// so the practical default is the bell. Listed in docs/platform-adoption/local-exceptions.md.
//
// NEVER IN A PAYLOAD: terminal output, a command, a credential, a host or a user@host
// pair. The server is named by its profile name.
// =============================================================================

import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

import { formatIdleDuration } from '../email-templates/idle-duration';
import { SESSIONS_PATH, type TerminalSessionReapedData } from '../email-templates/terminal-session-reaped.email';

export const TERMINAL_SESSION_REAPED_EVENT = 'terminal.session_reaped';

/** The bell and push rendering of `terminal.session_reaped`. Plain text; the link is root-relative. */
export function terminalSessionReapedBrowserTemplate(data: TerminalSessionReapedData) {
  const total = data.sessions.length + data.moreCount;
  const first = data.sessions[0];
  if (total === 1 && first) {
    return {
      title: 'Your terminal session was closed after inactivity',
      body: `"${first.name}" on ${first.serverName} was idle for ${formatIdleDuration(first.idleMinutes)}.`,
      link: SESSIONS_PATH,
    };
  }
  const names = data.sessions
    .slice(0, 3)
    .map((line) => `"${line.name}"`)
    .join(', ');
  const rest = total - Math.min(3, data.sessions.length);
  return {
    title: `${total} of your terminal sessions were closed after inactivity`,
    body: rest > 0 ? `${names} and ${rest} more.` : `${names}.`,
    link: SESSIONS_PATH,
  };
}

export const TERMINAL_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: TERMINAL_SESSION_REAPED_EVENT,
      label: 'Terminal session closed after inactivity',
      description:
        'Sent when an idle terminal session of yours is closed because it stayed disconnected past the limit an administrator set.',
      channels: ['browser', 'email', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: 'terminal-session-reaped',
    browserTemplate: terminalSessionReapedBrowserTemplate,
  },
];
