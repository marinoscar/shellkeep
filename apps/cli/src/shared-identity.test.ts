import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_NAME, CLI_NAME, REPO_SLUG } from '@shellkeep/shared';
import { describe, expect, it } from 'vitest';

// packages/shared/identity.json is the one place the product name, CLI name and
// repository slug are written (platform-infra sync reads the same file); the
// package's exports must be exactly its values.

const identity = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'shared', 'identity.json'), 'utf8'),
) as { productName: string; cliName: string; repoSlug: string };

describe('@shellkeep/shared', () => {
  it('exports APP_NAME, CLI_NAME and REPO_SLUG from identity.json', () => {
    expect(APP_NAME).toBe(identity.productName);
    expect(CLI_NAME).toBe(identity.cliName);
    expect(REPO_SLUG).toBe(identity.repoSlug);
    expect([APP_NAME, CLI_NAME, REPO_SLUG]).toEqual(['ShellKeep', 'shellkeep', 'marinoscar/shellkeep']);
  });

  it('keeps the CLI name a valid executable and config-directory seed', () => {
    expect(CLI_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
