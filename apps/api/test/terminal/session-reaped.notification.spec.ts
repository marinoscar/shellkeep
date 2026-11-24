// =============================================================================
// `terminal.session_reaped` (issue #51)
// =============================================================================
//
// The reaper tells each owner once, AFTER its updates committed and outside any
// `$transaction`. Proved with a recording prisma double: every statement and every
// `notify` is appended to one ordered log, so the order is asserted, not assumed.
// Fixture names are invented placeholders (`Person A`, `server-a.example.test`).
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { renderEmailTemplate } from '@marinoscar/platform-api/email';
import { findEvent, eventBrowserTemplateRegistry, eventEmailTemplateRegistry } from '@marinoscar/platform-api/notifications';

import { MAX_LISTED_SESSIONS, formatIdleDuration } from '../../src/email-templates/idle-duration';
import { terminalSessionReapedEmail } from '../../src/email-templates/terminal-session-reaped.email';
import { terminalSessionReapedBrowserTemplate } from '../../src/notifications-registry/terminal.notifications';
import {
  SessionReapHandler,
  buildReapedNotifications,
  type ReapedSession,
} from '../../src/terminal/jobs/session-reap.handler';

const NOW = new Date('2026-11-23T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function session(id: string, userId: string, profileId: string, idleMinutes: number): ReapedSession {
  return { id, userId, orgId: 'org-1', name: `Session ${id}`, serverProfileId: profileId, lastActivityAt: ago(idleMinutes) };
}

function build(terminated: ReapedSession[], opts: { notifyThrows?: boolean; profilesThrow?: boolean } = {}) {
  const log: string[] = [];
  const prisma = {
    $transaction: jest.fn(async () => {
      log.push('$transaction');
    }),
    terminalSession: {
      updateMany: jest.fn(async () => {
        log.push('update:detach');
        return { count: 0 };
      }),
      updateManyAndReturn: jest.fn(async () => {
        log.push('update:terminate');
        return terminated;
      }),
      deleteMany: jest.fn(async () => {
        log.push('delete:purge');
        return { count: 0 };
      }),
    },
    serverProfile: {
      findMany: jest.fn(async () => {
        log.push('profiles');
        if (opts.profilesThrow) throw new Error('db down');
        return [
          { id: 'profile-1', name: 'Server A' },
          { id: 'profile-2', name: 'Server B' },
        ];
      }),
    },
  };
  const notify = jest.fn(async (event: string, userId: string) => {
    log.push(`notify:${event}:${userId}`);
    if (opts.notifyThrows) throw new Error('boom');
  });
  const handler = new SessionReapHandler(
    { register: jest.fn() } as never,
    prisma as never,
    { getNamespace: async () => ({ detachAfterMinutes: 60, terminateDetachedAfterHours: 12, purgeTerminatedAfterDays: 3 }) } as never,
    { notify } as never,
    { sessionTerminated: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { handler, prisma, notify, log };
}

describe('terminal.session_reaped producer', () => {
  it('calls notify once per owner, listing every session of that owner', async () => {
    const { handler, notify } = build([
      session('a1', 'person-a', 'profile-1', 800),
      session('a2', 'person-a', 'profile-2', 900),
      session('b1', 'person-b', 'profile-1', 760),
    ]);

    await handler.notifyOwners(
      [session('a1', 'person-a', 'profile-1', 800), session('a2', 'person-a', 'profile-2', 900), session('b1', 'person-b', 'profile-1', 760)],
      NOW,
    );

    expect(notify).toHaveBeenCalledTimes(2);
    const byUser = new Map(notify.mock.calls.map((call) => [call[1], call as unknown[]]));
    const personA = byUser.get('person-a')?.[2] as { sessions: Array<{ name: string; serverName: string; idleMinutes: number }>; moreCount: number };
    expect(personA.moreCount).toBe(0);
    // Longest idle first, the server named by its PROFILE name.
    expect(personA.sessions).toEqual([
      { name: 'Session a2', serverName: 'Server B', idleMinutes: 900 },
      { name: 'Session a1', serverName: 'Server A', idleMinutes: 800 },
    ]);
    expect(notify).toHaveBeenCalledWith('terminal.session_reaped', 'person-b', expect.anything());
  });

  it('notifies only after the reaper statements ran, and never inside a $transaction', async () => {
    const { handler, prisma, log } = build([session('a1', 'person-a', 'profile-1', 800)]);

    await handler.process({ id: 'job-1' } as never);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    const firstNotify = log.findIndex((entry) => entry.startsWith('notify:'));
    expect(firstNotify).toBeGreaterThan(-1);
    for (const statement of ['update:detach', 'update:terminate', 'delete:purge']) {
      expect(log.indexOf(statement)).toBeGreaterThan(-1);
      expect(log.indexOf(statement)).toBeLessThan(firstNotify);
    }
    expect(log).not.toContain('$transaction');
  });

  it('sends nothing when no session was terminated', async () => {
    const { handler, notify, prisma } = build([]);
    await handler.process({ id: 'job-1' } as never);
    expect(notify).not.toHaveBeenCalled();
    expect(prisma.serverProfile.findMany).not.toHaveBeenCalled();
  });

  it('never fails the job when the notification path throws', async () => {
    const { handler, prisma } = build([session('a1', 'person-a', 'profile-1', 800)], { notifyThrows: true });
    await expect(handler.process({ id: 'job-1' } as never)).resolves.toBeUndefined();
    expect(prisma.terminalSession.updateManyAndReturn).toHaveBeenCalled();

    const lookupFails = build([session('a1', 'person-a', 'profile-1', 800)], { profilesThrow: true });
    await expect(lookupFails.handler.process({ id: 'job-2' } as never)).resolves.toBeUndefined();
    expect(lookupFails.notify).not.toHaveBeenCalled();
  });

  it('caps the listing and counts the rest', () => {
    const many = Array.from({ length: MAX_LISTED_SESSIONS + 3 }, (_, i) => session(`s${i}`, 'person-a', 'profile-1', 700 + i));
    const result = buildReapedNotifications(many, new Map([['profile-1', 'Server A']]), NOW).get('person-a');
    expect(result?.sessions).toHaveLength(MAX_LISTED_SESSIONS);
    expect(result?.moreCount).toBe(3);
  });

  it('reads an unknown profile as "a server" rather than leaking an id', () => {
    const result = buildReapedNotifications([session('s1', 'person-a', 'gone', 90)], new Map(), NOW).get('person-a');
    expect(result?.sessions[0]?.serverName).toBe('a server');
  });
});

describe('terminal.session_reaped event and templates', () => {
  const data = {
    sessions: [{ name: 'Build <b>shell</b>', serverName: 'server-a.example.test', idleMinutes: 185 }],
    moreCount: 0,
  };

  it('is registered with in-app, email and push channels and both templates', () => {
    const event = findEvent('terminal.session_reaped');
    expect(event?.channels).toEqual(['browser', 'email', 'push']);
    expect(event?.mandatory).toBeUndefined();
    expect(eventEmailTemplateRegistry.get('terminal.session_reaped')?.template).toBe('terminal-session-reaped');
    expect(eventBrowserTemplateRegistry.get('terminal.session_reaped')).toBeDefined();
  });

  it('renders the email through the registry, escaped, with a link to Sessions', () => {
    const rendered = renderEmailTemplate('terminal-session-reaped', data);
    expect(rendered.subject).toBe('Your terminal session was closed after inactivity');
    expect(rendered.html).toContain('Build &lt;b&gt;shell&lt;/b&gt;');
    expect(rendered.html).not.toContain('<b>shell</b>');
    expect(rendered.html).toContain('/sessions');
    expect(rendered.text).toContain('server-a.example.test');
    expect(rendered.text).toContain('3 hours 5 minutes');
  });

  it('pluralises the subject and mentions the sessions that did not fit', () => {
    const rendered = terminalSessionReapedEmail({ sessions: [data.sessions[0]!, data.sessions[0]!], moreCount: 4 });
    expect(rendered.subject).toBe('6 of your terminal sessions were closed after inactivity');
    expect(rendered.text).toContain('and 4 more');
  });

  it('renders the bell and push text as plain text with a root-relative link', () => {
    const one = terminalSessionReapedBrowserTemplate(data);
    expect(one.link).toBe('/sessions');
    expect(one.title).toBe('Your terminal session was closed after inactivity');
    expect(one.body).toContain('idle for 3 hours 5 minutes');
    const many = terminalSessionReapedBrowserTemplate({ sessions: [data.sessions[0]!, data.sessions[0]!], moreCount: 2 });
    expect(many.title).toBe('4 of your terminal sessions were closed after inactivity');
    expect(many.body).toContain('and 2 more');
  });

  it('carries no credential, user@host pair or output fields in its payload type', () => {
    const rendered = renderEmailTemplate('terminal-session-reaped', data);
    expect(rendered.html + rendered.text).not.toMatch(/password|passphrase|private key|@server-a/i);
    expect(Object.keys(data.sessions[0]!).sort()).toEqual(['idleMinutes', 'name', 'serverName']);
  });
});

describe('formatIdleDuration', () => {
  it.each([
    [0, 'less than a minute'],
    [1, '1 minute'],
    [45, '45 minutes'],
    [60, '1 hour'],
    [125, '2 hours 5 minutes'],
    [1440, '1 day'],
    [1500, '1 day 1 hour'],
  ])('%d minutes reads as %s', (minutes, text) => {
    expect(formatIdleDuration(minutes)).toBe(text);
  });
});
