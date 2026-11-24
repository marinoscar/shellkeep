// =============================================================================
// OpenAPI tag taxonomy (issue #46)
// =============================================================================
//
// Every `@ApiTags(...)` name the composed app's controllers use (ShellKeep's own
// and the packaged slices'), its description and the sidebar section it belongs
// to, registered into core's `openApiTags` registry. A tag a controller uses but
// nobody registered renders with no description and the Spectral rules in
// `.spectral.yaml` fail the build.
//
// Imported by `shellkeep.manifest.ts` (a side effect), so `main.ts`, the dump script
// and the tests all see the same registry.
// =============================================================================

import { openApiTags } from '@marinoscar/platform-api/core';

interface AppOpenApiTag {
  readonly name: string;
  readonly description: string;
}

interface AppOpenApiTagGroup {
  readonly name: string;
  readonly tags: readonly AppOpenApiTag[];
}

/**
 * Sidebar sections, in render order. Every `@ApiTags(...)` name a controller of
 * the composed app uses appears here, the packaged slices' included: a slice
 * does not register its own tags, the app that mounts it does. A slice adopted
 * later (AI) adds its tags in its own issue.
 */
const TAG_GROUPS: readonly AppOpenApiTagGroup[] = [
  {
    name: 'Authentication & Access',
    tags: [
      {
        name: 'Authentication',
        description:
          'Google OAuth sign-in, access-token refresh, logout, and the current-user lookup. ' +
          'Start here: every other section assumes a bearer token obtained through one of these routes.',
      },
      {
        name: 'Device Authorization',
        description:
          'RFC 8628 device authorization grant: how a CLI or other browserless client obtains a ' +
          'token by showing the user a code to approve elsewhere, plus management of the resulting ' +
          'device sessions.',
      },
      {
        name: 'Personal Access Tokens',
        description:
          'Long-lived `pat_` bearer credentials for scripts and automation. A PAT carries the full ' +
          'permission set of the user that minted it and is accepted on every authenticated route.',
      },
      {
        name: 'Allowlist',
        description:
          'Pre-authorized email addresses. Access is allowlist-gated: an email absent from this list ' +
          'cannot complete OAuth sign-in at all. Admin only.',
      },
      {
        name: 'Organizations',
        description:
          'Organizations, their members and invitations. `/api/org/*` acts on the organization the ' +
          'caller\'s token is bound to, never on an organization id from the request. ShellKeep runs in ' +
          'single-organization mode, where organization management stays hidden.',
      },
      {
        name: 'Test Authentication',
        description:
          'Token minting for automated tests. The module is registered only when ' +
          '`NODE_ENV !== "production"`, so these routes are absent from a production document entirely.',
      },
    ],
  },
  {
    name: 'Account & Settings',
    tags: [
      {
        name: 'Users',
        description:
          'User administration: listing, inspecting, activating and deactivating accounts, and ' +
          'assigning system roles. Admin only.',
      },
      {
        name: 'Roles',
        description:
          'The roles the application knows: label, scope (`system` or `org`) and whether the invite, member ' +
          'and user-role routes may assign each.',
      },
      {
        name: 'User Settings',
        description:
          'The calling user\'s own preferences, stored as a JSON document. Supports full replacement ' +
          '(`PUT`) and JSON Merge Patch (`PATCH`).',
      },
      {
        name: 'System Settings',
        description:
          'Deployment-wide configuration, stored as a JSON document. Readable by any signed-in user; ' +
          'writable only with `system_settings:write`.',
      },
      {
        name: 'Organization Settings',
        description:
          'The caller\'s active organization\'s overrides of the org-overridable system settings ' +
          'namespaces, with the effective (system then organization) value of each. Needs ' +
          '`org_settings:read` / `org_settings:write`.',
      },
    ],
  },
  {
    name: 'Servers & Terminal',
    tags: [
      {
        name: 'Server Profiles',
        description:
          'SSH server profiles: host, port, user and credentials (encrypted, write-only), the pinned host-key ' +
          'fingerprint, and a connection test. A caller sees only the profiles of their organization they own.',
      },
      {
        name: 'Terminal Sessions',
        description:
          'Persistent tmux-backed terminal sessions on a server profile: create, list, rename and terminate. ' +
          'The terminal itself is the WebSocket at `/api/terminal/ws`, which is not part of this document.',
      },
    ],
  },
  {
    name: 'Storage',
    tags: [
      {
        name: 'Storage',
        description:
          'File objects: simple upload, resumable multipart upload, signed download URLs, metadata, ' +
          'and deletion. A caller sees only the objects they uploaded.',
      },
      {
        name: 'Storage Configuration',
        description:
          'Where the deployment keeps its objects: the provider, bucket and key pair (runtime configuration, ' +
          'never environment variables), the connection test, bucket creation and the copy-only migration ' +
          'between providers. Admin only.',
      },
    ],
  },
  {
    name: 'Jobs & Nodes',
    tags: [
      {
        name: 'Jobs',
        description:
          'The background job queue: what is queued, running, finished or failed (session reaping, ' +
          'credential cleanup), and the controls to retry or cancel a job. Gated on `jobs:read`/`jobs:write`.',
      },
      {
        name: 'Worker Nodes',
        description:
          'The worker fleet that executes node-eligible jobs: registration, heartbeats, health, and ' +
          'draining a node before it is retired. Gated on `nodes:read`/`nodes:write`, separately ' +
          'from the queue itself.',
      },
    ],
  },
  {
    name: 'Notifications',
    tags: [
      {
        name: 'Notifications',
        description:
          'The calling user\'s inbox (list, unread count, mark read, dismiss), the preferences matrix of events and ' +
          'channels, the live SSE stream, and the browser\'s Web Push subscriptions. Every route acts on the caller\'s own notifications.',
      },
      {
        name: 'Notification Broadcasts',
        description:
          'Administrator announcements to every user (or one organization): compose, schedule, cancel and review ' +
          'delivery. Gated on `broadcasts:read`/`broadcasts:write`.',
      },
      {
        name: 'Push Configuration',
        description:
          'Web Push (VAPID) keys, generated and rotated at runtime with the private key held in the credential store, and ' +
          'a test push. Never an environment variable. Gated on `push:read`/`push:write`.',
      },
      {
        name: 'Email Settings',
        description:
          'The email transport (SMTP or SES), sender and the test send, configured at runtime with secrets held in the ' +
          'credential store. Gated on `system_settings:read`/`system_settings:write`.',
      },
    ],
  },
  {
    name: 'Operations',
    tags: [
      {
        name: 'Health',
        description:
          'Liveness and readiness probes for orchestrators and load balancers. Public: a probe that ' +
          'needed a token could not report that authentication is down.',
      },
      {
        name: 'About',
        description:
          'What is actually deployed here: the API version, the deploy document `appctl deploy` leaves on disk, ' +
          'a database liveness fact and the terminal section (session counts, ssh2 version, reaper thresholds). ' +
          'Gated on `system_settings:read`. Always answers 200, and stays readable during a maintenance window.',
      },
      {
        name: 'Doctor',
        description:
          'Read-only configuration and health checks for every capability of this deployment, including the ' +
          'terminal\'s (SSH client, tmux probe, session reaper, legacy secrets), each with a status, a one-line ' +
          'detail and, when something needs attention, a remedy. Gated on `system_settings:read`. ' +
          'Always answers 200: a failing check is a row, not a status code.',
      },
      {
        name: 'Maintenance',
        description:
          'The maintenance window: turning it on, the message callers see while it is open, and ' +
          'whether administrators keep access. Gated on `system_settings:read` and `system_settings:write`. ' +
          'New terminal WebSocket connections are refused while it is open; open ones keep streaming.',
      },
      {
        name: 'Telemetry',
        description:
          'Observability: whether traces, logs and metrics are exported to the telemetry store ' +
          '(GreptimeDB), how long they are retained, the runtime connection to the store, the explorer, ' +
          'the dashboard (including the Terminal metric group) and the store\'s status. The policy is ' +
          '`telemetry:read`/`telemetry:write`; running queries against the data is `telemetry:query`. ' +
          '`GET /api/telemetry/config` is readable by any signed-in user: it is how a client learns ' +
          'whether to show telemetry surfaces at all.',
      },
    ],
  },
];

let registered = false;

/** Registers ShellKeep's tags once per process (the registry freezes at bootstrap). */
export function registerShellkeepOpenApiTags(): void {
  if (registered) return;
  registered = true;
  for (const group of TAG_GROUPS) {
    for (const tag of group.tags) {
      openApiTags.register({ name: tag.name, group: group.name, description: tag.description });
    }
  }
}

registerShellkeepOpenApiTags();
