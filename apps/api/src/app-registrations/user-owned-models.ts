// =============================================================================
// ShellKeep's user-owned models (issue #47)
// =============================================================================
//
// Every ShellKeep model with a foreign key to `User`, classified for the
// platform's user-data machinery (the scoped client, the user-data export and
// purge planner, and the `user-owned-data` conformance suite, which fails when
// this list and `prisma/schema/` disagree). The registration itself is
// `registrations.ts`; this file only declares.
//
// PURGE FOLLOWS `onDelete`: both models cascade with the user, so `delete`.
// =============================================================================

import type { Prisma } from '@prisma/client';
import type { UserOwnedModelDef } from '@marinoscar/platform-api/core';

type Def = UserOwnedModelDef<Prisma.ModelName>;

export const APP_USER_OWNED_MODELS: readonly Def[] = [
  {
    model: 'ServerProfile',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    // The three encrypted columns are removed by #48 (the credential store);
    // until then the ciphertext must never leave the server.
    exportOmit: ['encryptedPassword', 'encryptedPrivateKey', 'encryptedPassphrase'],
    rationale:
      'The owner’s SSH connection profile; deleted with the user and exported to them without any credential ciphertext.',
  },
  {
    model: 'TerminalSession',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: 'The owner’s terminal session record (tmux session name, size, status); deleted with the user and exported to them.',
  },
];
