// =============================================================================
// The email slice's composition (issue #51)
// =============================================================================
//
// One `EmailModule.forRoot`: the SMTP and SES transports, `/api/email-settings`
// (`system_settings:read|write`), the template registry and layout and the
// doctor check, from `@marinoscar/platform-api/email`. The transport is chosen
// and its secrets are entered at runtime (`/admin/settings/email`); there is no
// email environment variable.
//
// NOT GLOBAL: `SmtpEmailProvider` reaches the plaintext `CredentialsService`
// secret reader, so every consumer writes `imports: [emailModule]`. Export the
// ONE `forRoot()` result and import that object everywhere (one module to Nest).
// The credential purposes (`smtp`, `email_ses`) are registered by
// `app-registrations/credentials.ts`; ShellKeep's templates by
// `platform/notifications/notification.manifest.ts`.
// =============================================================================

import { EmailModule } from '@marinoscar/platform-api/email';

import { EMAIL_MODULE_OPTIONS } from './email.options';

export { EMAIL_MODULE_OPTIONS };

export const emailModule = EmailModule.forRoot(EMAIL_MODULE_OPTIONS);
