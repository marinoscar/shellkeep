// =============================================================================
// The platform-db conformance suite, run against this app
// =============================================================================
//
// Offline: no database. It proves what an app owes the package:
//   - the raw-SQL index tripwire: every partial or expression index in the
//     migrations is listed (the platform's in RAW_SQL_INDEXES, the app's in
//     platform.lock), none is redeclared with @@unique/@@index in a fragment;
//   - platform.lock: the installed migrations are byte-identical to the
//     package's, none missing, none edited.
// =============================================================================

import { join } from 'node:path';

import { runDbConformance } from '@marinoscar/platform-db';

runDbConformance({ appRoot: join(__dirname, '..', '..') });
