import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCli } from '@marinoscar/platform-cli';
import { PLATFORM_DOCUMENTED_OPTIONAL_KEYS, resetCliForTests, runPlatformConformance } from '@marinoscar/platform-cli/testing';
import { describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from './app.js';

// =============================================================================
// The platform's CLI conformance over ShellKeep  (issue #72)
// =============================================================================
//
//   - `cli`: no env template fragment (the platform base, ShellKeep's own
//     app.env.example) declares a commented `# KEY=value` line, and every node
//     executor the worker would run (the platform's, and ShellKeep's: none yet)
//     leaves no job-scoped credential behind;
//   - `deployRegistrations`: the env groups, steps, checks, stream paths and
//     edge-config files ShellKeep registered are consistent and the vhost renders
//     with its stream paths;
//   - `tui`: the menu tree is sound, screens load lazily, importing the TUI
//     entries loads no ink, labels are non-empty, screens render at narrow
//     widths and without colour. ShellKeep wires no dashboard yet (the Runs
//     screen's DashboardSource arrives with the runbook engine).
// =============================================================================

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

resetCliForTests();
createCli(APP_CLI_OPTIONS);

runPlatformConformance({
  suites: {
    cli: {
      envFragments: [
        {
          name: '@marinoscar/platform-infra/env/base.env.example',
          text: read('node_modules/@marinoscar/platform-infra/env/base.env.example'),
          allowCommented: PLATFORM_DOCUMENTED_OPTIONAL_KEYS,
        },
        { name: 'infra/compose/app.env.example', text: read('infra/compose/app.env.example') },
      ],
    },
    deployRegistrations: {},
    tui: { importEntries: ['@marinoscar/platform-cli/tui'] },
  },
  testApi: { describe, it, expect },
});
