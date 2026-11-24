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
// PURGE FOLLOWS `onDelete`: the server profile and the terminal session cascade with the user,
// so `delete`; the runbook tables (#61) are SET NULL, so `detach` (the organization keeps them).
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
    // Every credential column, explicitly (#68): the default redaction rule does not match these names.
    // The credential store (`profile.<id>.<field>`, purpose `ssh`) is never read by an export; the three
    // legacy ciphertext columns remain until their data is migrated, so they stay omitted.
    // `fingerprint` stays: it is public host-key material.
    exportOmit: ['encryptedPassword', 'encryptedPrivateKey', 'encryptedPassphrase'],
    rationale:
      'The owner’s SSH connection profile; deleted with the user and exported to them without any credential or ciphertext.',
  },
  {
    model: 'TerminalSession',
    ownerField: 'userId',
    purge: 'delete',
    // `tmuxSessionId` (the tmux session name) is included; the tmux scrollback is never stored here or read.
    export: 'include',
    rationale: 'The owner’s terminal session record (tmux session name, size, status); deleted with the user and exported to them.',
  },
  {
    model: 'Runbook',
    ownerField: 'ownerUserId',
    ownerRelation: 'owner',
    // `owner_user_id` is ON DELETE SET NULL: the organization keeps the runbook when its author goes.
    purge: 'detach',
    // The runbook definition is the author's own work (#68). Run step output is never exported as rows.
    export: 'include',
    rationale:
      'An organization-owned runbook records its author; the author leaving detaches the runbook (the organization keeps it), and the runbooks they authored are exported to them.',
  },
  {
    model: 'RunbookVersion',
    actorFields: ['createdBy'],
    // `created_by` is ON DELETE SET NULL: a version is immutable history and outlives its author.
    purge: 'detach',
    export: 'include',
    rationale:
      'An immutable runbook version records who saved it; the author leaving detaches the version (it is never rewritten or deleted) and the versions they saved, with their definitions, are exported to them.',
  },
];
