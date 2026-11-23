// =============================================================================
// The email slice's options (issue #51)
// =============================================================================
//
// FRAMEWORK-FREE, so the notification manifest (which configures the render
// context at import time, before Nest composes anything) and
// `EmailModule.forRoot` read the SAME options.
//
// Nothing here is runtime email configuration (transport, relay, sender,
// secrets): that is `/admin/settings/email`, stored through the settings and
// credential slices. `APP_URL` is the existing deployment variable; no variable
// is added for email.
// =============================================================================

import type { EmailModuleOptions } from '@marinoscar/platform-api/email';
import { classifyRateLimit } from '@marinoscar/platform-api/jobs';

/** The product name rendered in every message (mirrors `packages/shared/identity.json`). */
export const EMAIL_APP_NAME = 'ShellKeep';

/** The deployment's base URL when `APP_URL` is unset (the dev default `config/configuration.ts` uses). */
const DEFAULT_APP_URL = 'http://localhost:3535';

export const EMAIL_MODULE_OPTIONS: EmailModuleOptions = {
  appName: EMAIL_APP_NAME,
  appUrl: () => process.env.APP_URL || DEFAULT_APP_URL,
  // The queue's own HTTP / SDK classifier, so a throttled SES send reads as a rate limit
  // exactly as a throttled job does.
  classifyRateLimit,
};
