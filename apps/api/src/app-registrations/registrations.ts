// =============================================================================
// The app's platform registrations (issue #47)
// =============================================================================
//
// IMPORT THIS BEFORE ANYTHING THAT READS THE ROLE, PERMISSION OR OWNERSHIP
// REGISTRIES: `shellkeep.manifest.ts` (so `main.ts`, `app.module.ts` and
// `test/setup.ts`) and the seed catalog script import it first. It fills core's
// static registries with the platform's roles and permissions plus ShellKeep's,
// the user-owned model inventory and the model ownership classification. The
// registries freeze when the application bootstraps, so a late registration
// fails loudly.
//
// Registration is once per process: a second import is a no-op (the ES module
// cache), and registering the same id twice is `DUPLICATE_ID`.
//
// The credential purposes (`ssh`, #48) register here too.
//
// SLICES: only the platform slices ShellKeep has adopted contribute
// permissions. Append a slice here in the issue that adopts it (jobs #49,
// storage #50, notifications #51, ai #55, ...) and regenerate the catalog
// (`npm run catalog:permissions`).
// =============================================================================

import {
  registerPlatformModelOwnership,
  registerPlatformPermissions,
  registerPlatformUserOwnedModels,
} from '@marinoscar/platform-api/manifest';

import { APP_MODEL_OWNERSHIP } from './model-ownership';
import { ADOPTED_PLATFORM_SLICES } from './platform-slices';
import { APP_PERMISSIONS, RUNBOOK_PERMISSIONS } from './permissions';
import { APP_USER_OWNED_MODELS } from './user-owned-models';
import { registerShellkeepCredentialPurposes } from './credentials';
// Channels, email templates and notification events (#51); registers itself at import.
import './notifications';
// ShellKeep's webhook events (#54) and alert rule kinds (#54); each registers itself at import.
import './webhooks';
import './alerts';
import { registerFileErrorCodes } from '../files/files.error-codes';
import { registerSshErrorCodes } from '../ssh/ssh.error-codes';
import { registerTerminalAiErrorCodes } from '../terminal-ai/terminal-ai.error-codes';
import { registerRunbookRegistrations } from '../runbooks/runbooks.registrations';
import { registerShellkeepSharing } from './sharing';

registerPlatformPermissions({
  slices: [...ADOPTED_PLATFORM_SLICES],
  app: { permissions: [APP_PERMISSIONS, RUNBOOK_PERMISSIONS] },
});
registerPlatformUserOwnedModels(APP_USER_OWNED_MODELS);
registerPlatformModelOwnership(APP_MODEL_OWNERSHIP);
registerShellkeepCredentialPurposes();
registerSshErrorCodes();
// The files API codes: FILE_IS_BINARY, FILE_TOO_LARGE, SFTP_UNAVAILABLE, ... (#153).
registerFileErrorCodes();
// The terminal AI safety codes: AI_CONSENT_REQUIRED, AI_OUTPUT_SHARING_DISABLED (#56).
registerTerminalAiErrorCodes();
// The runbook error codes and notification events (#61).
registerRunbookRegistrations();
// The shareable resource types `server_profile` and `runbook` (#71).
registerShellkeepSharing();
