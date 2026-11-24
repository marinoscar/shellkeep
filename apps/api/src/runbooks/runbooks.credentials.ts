// =============================================================================
// The runbook secret credential purpose (issue #61)
// =============================================================================
//
// A `secret` parameter of a runbook is filled from the ORGANIZATION credential store
// (`OrgCredentialsService`), purpose `runbook_secret`, one credential per name
// (`^[a-z][a-z0-9_-]{0,63}$`). A run references the credential by name
// (`secretRefs: { PARAM: '<name>' }`); the value is never in a definition, a run row
// or a job payload.
//
// THE PURPOSE IS ALSO THE AES-GCM SUB-KEY DOMAIN (`org:<orgId>:runbook_secret`):
// renaming it orphans every secret stored under it. It is permanent.
// =============================================================================

import type { CredentialPurposeDef } from '@marinoscar/platform-api/credentials';

export const RUNBOOK_SECRET_PURPOSE = 'runbook_secret';

/** The names a runbook secret may have. */
export const RUNBOOK_SECRET_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const RUNBOOK_SECRET_PURPOSE_DEF: CredentialPurposeDef = {
  purpose: RUNBOOK_SECRET_PURPOSE,
  owner: 'app',
  label: 'Runbook secret parameter',
  tiers: ['org'],
};
