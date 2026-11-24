// =============================================================================
// The exports slice's conformance suite, run in ShellKeep (issue #68)
// =============================================================================
//
// Checked against THIS application's registries and real datamodel:
//   registry       every source (`user-data` and ShellKeep's `server-profiles`, `terminal-sessions` and
//                  `runbook-runs`) names a registered permission and offers a registered writer;
//   policy         every user-owned model exists in the datamodel and its `exportOmit` names real fields;
//   secret-egress  the suite fills EVERY model with sentinel values and runs `user-data` through every
//                  writer it offers, unzipping the zips: no secret, hash, hint, ciphertext or binary
//                  column reaches a byte of any output, and `encryptedPassword`, `encryptedPrivateKey`
//                  and `encryptedPassphrase` are named by `exportOmit`, since the default redaction rule
//                  does not match them.
//
// The real-database counterpart, which also covers ShellKeep's own sources, is `exports.db.spec.ts`.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { permissionRegistry } from '@marinoscar/platform-api/core';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `exports` suite with the harness.
import '@marinoscar/platform-api/exports/testing';

// The export registrations (platform sources and writers, ShellKeep's sources).
import '../../src/platform/exports/exports.config';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    exports: {
      datamodel: Prisma.dmmf.datamodel,
      permissions: permissionRegistry.list(),
    },
  },
});
