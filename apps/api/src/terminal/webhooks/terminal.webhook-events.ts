// =============================================================================
// ShellKeep's webhook events (issue #54)
// =============================================================================
//
// Registered into the webhooks slice's open catalog (`registerWebhookEvent`) at import
// time, by `app-registrations/webhooks.ts`, before the registry freezes at bootstrap.
// EVENT KEYS ARE PERMANENT: a receiver subscribes to a key, and a stored endpoint names
// it. Add an event; never rename one.
//
//   terminal.session.created        a terminal session was created
//   terminal.session.terminated     a session ended (user, batch or the idle reaper)
//   server_profile.host_key_changed a trusted SSH host key was replaced by a different one (#60)
//
// AUDIENCE `user`: the owner's own endpoints (a member's, created at `/api/webhooks`)
// receive the event, scoped to the owner of the session or the profile. An organization
// or deployment endpoint does not see another member's terminal activity. The endpoint's
// owner must still hold the event's permission when it fans out.
//
// PAYLOADS CARRY IDS, NAMES AND TIMES ONLY. Never terminal output or input, a command, a
// hostname, a username, a credential or a key's material: the server is named by its
// profile NAME, and a host key by its public fingerprint (`SHA256:...`). The schemas are
// strict: an extra field fails validation and nothing is sent, so a secret cannot be added
// to a payload by accident.
//
// The runbook events (`runbooks.run.finished`, ...) are registered by Fleet Runbooks (#66)
// with its module, not here.
// =============================================================================

import { z } from 'zod';
import { registerWebhookEvent } from '@marinoscar/platform-api/webhooks';

/** The webhook event keys ShellKeep raises. PERMANENT. */
export const TERMINAL_WEBHOOK_EVENTS = {
  SESSION_CREATED: 'terminal.session.created',
  SESSION_TERMINATED: 'terminal.session.terminated',
  HOST_KEY_CHANGED: 'server_profile.host_key_changed',
} as const;

/** Why a session ended: its owner (`user`), the owner's batch action (`batch`) or the idle reaper (`reaped`). */
export const SESSION_TERMINATION_REASONS = ['user', 'reaped', 'batch'] as const;
export type SessionTerminationReason = (typeof SESSION_TERMINATION_REASONS)[number];

const isoTimestamp = z.iso.datetime();

export const sessionCreatedDataSchema = z
  .object({
    sessionId: z.uuid(),
    serverProfileId: z.uuid(),
    serverProfileName: z.string().min(1).max(200),
    createdAt: isoTimestamp,
  })
  .strict();
export type SessionCreatedData = z.infer<typeof sessionCreatedDataSchema>;

export const sessionTerminatedDataSchema = z
  .object({
    sessionId: z.uuid(),
    serverProfileId: z.uuid(),
    reason: z.enum(SESSION_TERMINATION_REASONS),
    terminatedAt: isoTimestamp,
  })
  .strict();
export type SessionTerminatedData = z.infer<typeof sessionTerminatedDataSchema>;

export const hostKeyChangedDataSchema = z
  .object({
    serverProfileId: z.uuid(),
    previousFingerprint: z.string().min(1).max(200),
    presentedFingerprint: z.string().min(1).max(200),
    detectedAt: isoTimestamp,
  })
  .strict();
export type HostKeyChangedData = z.infer<typeof hostKeyChangedDataSchema>;

const EXAMPLE_SESSION = '00000000-0000-4000-8000-000000000001';
const EXAMPLE_PROFILE = '00000000-0000-4000-8000-000000000002';

let registered = false;

/** Registers the three events. Idempotent per process (a second registration is `DUPLICATE_ID`). */
export function registerTerminalWebhookEvents(): void {
  if (registered) return;
  registered = true;

  registerWebhookEvent({
    key: TERMINAL_WEBHOOK_EVENTS.SESSION_CREATED,
    label: 'Terminal session created',
    description: 'One of your terminal sessions was created. Carries ids and the server profile name, never terminal content.',
    group: 'Terminal',
    audience: 'user',
    permission: 'sessions:read',
    payloadSchema: sessionCreatedDataSchema,
    example: {
      sessionId: EXAMPLE_SESSION,
      serverProfileId: EXAMPLE_PROFILE,
      serverProfileName: 'Server A',
      createdAt: '2026-11-01T10:00:00.000Z',
    } satisfies SessionCreatedData,
    source: 'terminal',
  });

  registerWebhookEvent({
    key: TERMINAL_WEBHOOK_EVENTS.SESSION_TERMINATED,
    label: 'Terminal session terminated',
    description:
      'One of your terminal sessions ended: you terminated it (user), terminated several at once (batch) or the idle reaper closed it (reaped).',
    group: 'Terminal',
    audience: 'user',
    permission: 'sessions:read',
    payloadSchema: sessionTerminatedDataSchema,
    example: {
      sessionId: EXAMPLE_SESSION,
      serverProfileId: EXAMPLE_PROFILE,
      reason: 'user',
      terminatedAt: '2026-11-01T10:30:00.000Z',
    } satisfies SessionTerminatedData,
    source: 'terminal',
  });

  registerWebhookEvent({
    key: TERMINAL_WEBHOOK_EVENTS.HOST_KEY_CHANGED,
    label: 'Server host key changed',
    description:
      'The trusted SSH host key of one of your server profiles was replaced by a different one. Carries both public fingerprints, never key material.',
    group: 'Server profiles',
    audience: 'user',
    permission: 'servers:read',
    payloadSchema: hostKeyChangedDataSchema,
    example: {
      serverProfileId: EXAMPLE_PROFILE,
      previousFingerprint: 'SHA256:ExamplePreviousFingerprint000000000000000000000',
      presentedFingerprint: 'SHA256:ExamplePresentedFingerprint000000000000000000000',
      detectedAt: '2026-11-01T10:00:00.000Z',
    } satisfies HostKeyChangedData,
    source: 'terminal',
  });
}
