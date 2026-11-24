// =============================================================================
// The user-data slice's conformance suite, run in ShellKeep (issue #69)
// =============================================================================
//
// Checked against THIS application's registries and composed schema:
//   - every model with an owner column (`ServerProfile`, `TerminalSession`, `Runbook` and the platform's)
//     has an explicit keep-or-delete decision that the `everything` scope reaches;
//   - every hint and scope names a model, a column and a category that exist (`servers`, `sessions` and
//     `runbooks` are registered, and so are the scopes' categories);
//   - a delete order exists (no cycle among the models a purge deletes).
//
// The same three checks run on a deployment as the Doctor check `user-data.registries`.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { join } from 'node:path';

import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import { composedSchemaDatamodel } from '@marinoscar/platform-api/user-data';
// Importing the testing entry REGISTERS the `user-data` suite with the harness.
import '@marinoscar/platform-api/user-data/testing';

// Fills the user-data registries: the platform's, then ShellKeep's.
import '../../src/platform/user-data/user-data.manifest';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    userData: { datamodel: composedSchemaDatamodel(__dirname)() },
  },
});
