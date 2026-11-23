---
name: add-notification
description: Add a notification event to the platform notifications slice - write the email template, declare the event with registerNotification, add it to the manifest, and call notify() after the triggering write commits. Use when a feature must tell a user something over email, the in-app bell or Web Push (a runbook run finished, a host key changed, a backup failed), when adding an event to the preferences matrix, or when editing an existing notification template or event.
---

# Add a notification

**Applies from #51** (email, notifications, broadcasts and Web Push from the platform). Before that, do not add a second dispatcher.

Email and notifications are the platform's slices: `@marinoscar/platform-api/email` and `@marinoscar/platform-api/notifications`; on the web `@marinoscar/platform-web/notifications/{headless,ui}`. ShellKeep owns three things: **email templates** (`apps/api/src/email-templates/`, *target*), **event registrations** (`apps/api/src/notifications-registry/`, *target*) and **the call sites**. The contract is the TSDoc in `node_modules/@marinoscar/platform-api/dist/notifications/` and `dist/email/templates/`.

No migration and no preference row: the sparse `notifications` user setting treats an absent key as the event's default.

## Steps

1. **Email template** (only if the event declares `email`): `apps/api/src/email-templates/<name>.email.ts`, a pure function returning `{ subject, html, text }`.
   ```ts
   import { html, renderLayout, safeUrl, type EmailTemplate } from '@marinoscar/platform-api/email';
   ```
   Build the body with the `html` tag so every interpolation is escaped, pass it to `renderLayout`, put any link through `safeUrl`, hand-write the `text` part. Declare the data type with `declare module '@marinoscar/platform-api/email' { interface EmailTemplateDataMap { 'name': NameEmailData } }` and register the renderer in the app's template list. A platform template (`role-changed`, `broadcast`, `job-failed`, `node-offline`, `backup-failed`, `restore-completed`, `test-email`) is not rewritten; bind the event to it by name. A template name is persisted in deliveries: never rename one.
2. **Declare the event** in `apps/api/src/notifications-registry/<domain>.notifications.ts` as a `NotificationRegistration`: a stable dotted lowercase `key` (`runbook.run_completed`), `label`, `description`, the `channels` it can really use (`email`, `browser`, `push`), `defaultEnabled`, and `mandatory: true` only for events a user must not silence (a security change such as `server.host_key_changed`). Add `emailTemplate` (and optional `browserTemplate`, with a root-relative `link`).
3. **Add the array to the manifest**: `registerNotifications([...])` in `apps/api/src/platform/notifications/notification.manifest.ts` *(target)*. Array order is the order of the preferences matrix. The registry validates atomically and freezes after bootstrap.
4. **Call `notify()` at the real trigger**, from a service that injects `NotificationsService`:
   ```ts
   await this.notifications.notify('runbook.run_completed', userId, payload satisfies RunCompletedEmailData);
   ```
   Place it **after** the triggering write has committed and **outside** any `$transaction`. `notify` is detached and never rejects. Other entry points: `notifyAddress`, `notifyPermissionHolders`, `notifyNow`.
5. **Tests.** Add the event to the notification events spec (key, channels, `mandatory`, template) and a snapshot spec beside the template. The `notifications` and `email` conformance suites (`after-commit`, `templates`, `channel-templates`, `no-secret`) must pass; `afterCommitAllowlist` stays empty.

## Rules

- Event keys, channel ids and template names are persisted. Never rename one; a rename is a new event.
- A notification is never a long-running job: do not render or send inline in a handler.
- **No terminal output, SSH secret, host credential or token in a payload, template or push body.** Name the server profile, not its credentials.
- Do not register `registerAndroidAppNotificationChannel` until the Android slice (#74) is adopted.
- The service worker never calls the API.

## Verify

```bash
cd apps/api && npm run typecheck && npx jest --config ./test/jest.config.js --runTestsByPath test/notifications test/conformance.spec.ts
```

Flag the new event for the docs agent (event inventory in `docs/ARCHITECTURE.md`).
