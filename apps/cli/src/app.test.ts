import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCli, cliIdentity, envPrefix, configDirName } from '@marinoscar/platform-cli';
import { androidTuiScreen, deployAndroidEnvVar } from '@marinoscar/platform-cli/android';
import { parseEnvExample } from '@marinoscar/platform-cli/deploy';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { getTuiRootMenuSlots, resolveTuiMenuSlot, resolveTuiTheme, tuiMenuScreens } from '@marinoscar/platform-cli/tui';
import { cleanup, renderTuiMenu, stripAnsi } from '@marinoscar/platform-cli/tui/testing';
import { APP_NAME, BRAND, TAGLINE } from '@shellkeep/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  APP_CLI_OPTIONS,
  APP_STREAM_PATHS,
  APP_TUI_MENU_ROOT,
  APP_TUI_THEME,
  APP_WORDMARK,
  APP_WORDMARK_MIN_COLUMNS,
  APP_UPDATE_NOTICE,
  APP_VERSIONED_MANIFESTS,
  readVersion,
} from './app.js';
import { SHELLKEEP_ENV_SPEC } from './extensions/env-spec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const packageVersion = (JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { version: string }).version;

beforeEach(() => resetCliForTests());

describe('the CLI identity', () => {
  it('is shellkeep, derived from identity.json', () => {
    const identity = JSON.parse(readFileSync(join(REPO, 'packages', 'shared', 'identity.json'), 'utf8')) as Record<string, string>;
    expect(identity.cliName).toBe('shellkeep');
    expect(APP_CLI_OPTIONS.identity).toEqual({
      name: 'shellkeep',
      displayName: 'ShellKeep CLI',
      productName: 'ShellKeep',
      repoSlug: 'marinoscar/shellkeep',
    });
  });

  it('derives SHELLKEEP_ and ~/.shellkeep', () => {
    createCli(APP_CLI_OPTIONS);
    expect(cliIdentity().name).toBe('shellkeep');
    expect(envPrefix()).toBe('SHELLKEEP_');
    expect(configDirName()).toBe('.shellkeep');
  });

  it('matches the bin key of package.json', () => {
    const manifest = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { bin: Record<string, string> };
    expect(Object.keys(manifest.bin)).toEqual([APP_CLI_OPTIONS.identity.name]);
  });
});

describe('the version', () => {
  it('is read at runtime from apps/cli/package.json, the only place it lives', () => {
    expect(readVersion()).toBe(packageVersion);
    expect(APP_CLI_OPTIONS.version).toBe(packageVersion);
  });
});

describe('deploy options', () => {
  it('versions the api, web and shared manifests, api first, and never the CLI', () => {
    expect(APP_VERSIONED_MANIFESTS).toEqual(['apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json']);
    expect(APP_CLI_OPTIONS.deploy?.versionedManifests).toEqual(APP_VERSIONED_MANIFESTS);
    expect(APP_VERSIONED_MANIFESTS).not.toContain('apps/cli/package.json');
  });

  it('streams the terminal WebSocket and the runbook run routes at the host proxy, without a trailing slash', () => {
    expect(APP_STREAM_PATHS).toEqual(expect.arrayContaining(['/api/terminal/ws', '/api/runbook-runs']));
    for (const path of APP_STREAM_PATHS) expect(path.endsWith('/')).toBe(false);
    expect(APP_CLI_OPTIONS.proxy?.streamPaths).toEqual(APP_STREAM_PATHS);
  });

  it('streams the same routes infra/nginx/app.d/locations gives the inner nginx', () => {
    const locations = ['terminal-ws.conf', 'runbook-streams.conf', 'ai-terminal-streams.conf']
      .map((file) => readFileSync(join(REPO, 'infra', 'nginx', 'app.d', 'locations', file), 'utf8'))
      .join('\n');
    for (const path of APP_STREAM_PATHS) expect(locations).toContain(path);
  });

  it('registers the three ShellKeep deploy checks and no node executor', () => {
    expect((APP_CLI_OPTIONS.deployChecks ?? []).map((check) => check.id)).toEqual(['docker-network-devnet', 'tmux-on-api-image', 'ssh-egress']);
    expect(APP_CLI_OPTIONS.nodeExecutors).toEqual([]);
  });

  it('tells operators how to update the CLI from main', () => {
    expect(APP_UPDATE_NOTICE.upgradeHint).toBe('curl -fsSL https://raw.githubusercontent.com/marinoscar/shellkeep/main/install.sh | bash');
    expect(typeof APP_UPDATE_NOTICE.latestVersion).toBe('function');
  });

  it('says ShellKeep deployments use 8323 for APP_BIND_PORT', () => {
    expect(APP_CLI_OPTIONS.envAnnotations?.APP_BIND_PORT?.help).toContain('8323');
  });
});

describe('the env-spec fragment', () => {
  const keys = (text: string): string[] => parseEnvExample(text).map((entry) => entry.key);

  it('carries metadata for every key of infra/compose/app.env.example', () => {
    const declared = keys(readFileSync(join(REPO, 'infra', 'compose', 'app.env.example'), 'utf8'));
    expect(declared).toEqual(expect.arrayContaining(['NGINX_PORT', 'COMPOSE_PROJECT_NAME', 'ENCRYPTION_KEY', 'SSH_EGRESS_TEST_HOST']));
    expect(Object.keys(SHELLKEEP_ENV_SPEC.metadata).sort()).toEqual([...declared].sort());
  });

  it('validates the keys it owns', () => {
    const validate = (key: string, value: string): string | undefined => SHELLKEEP_ENV_SPEC.metadata[key]?.validate?.(value);
    expect(validate('NGINX_PORT', '8323')).toBeUndefined();
    expect(validate('NGINX_PORT', 'web')).toBeDefined();
    expect(validate('COMPOSE_PROJECT_NAME', 'shellkeep')).toBeUndefined();
    expect(validate('COMPOSE_PROJECT_NAME', 'Has Spaces')).toBeDefined();
    expect(validate('SSH_EGRESS_TEST_HOST', 'ssh-test.example.test:22')).toBeUndefined();
    expect(validate('SSH_EGRESS_TEST_HOST', 'a b')).toBeDefined();
  });

  it('does not repeat a key the platform owns (createCli would throw)', () => {
    expect(() => createCli(APP_CLI_OPTIONS)).not.toThrow();
  });
});

describe('the commands', () => {
  it('adds servers, sessions and runbook after the platform commands', () => {
    const names = createCli(APP_CLI_OPTIONS).program.commands.map((command) => command.name());
    expect(names).toEqual(['init', 'login', 'api', 'config', 'node', 'deploy', 'servers', 'sessions', 'runbook', 'android']);
  });
});

describe('the Android companion (#74)', () => {
  it('adds the android group with its subcommands', () => {
    const android = createCli(APP_CLI_OPTIONS).program.commands.find((command) => command.name() === 'android');
    const subcommands = android?.commands.map((command) => command.name()) ?? [];
    for (const name of ['doctor', 'keystore', 'version', 'build', 'publish', 'release', 'releases']) {
      expect(subcommands).toContain(name);
    }
  });

  it('adds the Android TUI screen after the app screens', () => {
    expect(APP_CLI_OPTIONS.tuiScreens?.at(-1)).toBe(androidTuiScreen);
  });

  it('registers the optional deploy step on the install and update pipelines', () => {
    const steps = APP_CLI_OPTIONS.deploySteps ?? [];
    expect(steps.map((step) => step.pipeline).sort()).toEqual(['install', 'update']);
    expect(steps.map((step) => [step.id, step.after])).toEqual([
      ['android-release', 'verify'],
      ['android-release', 'verify'],
    ]);
  });

  it('skips the deploy step unless SHELLKEEP_DEPLOY_ANDROID=1', () => {
    createCli(APP_CLI_OPTIONS);
    const previous = process.env.SHELLKEEP_DEPLOY_ANDROID;
    try {
      delete process.env.SHELLKEEP_DEPLOY_ANDROID;
      const step = (APP_CLI_OPTIONS.deploySteps ?? [])[0]?.step;
      expect(step).toBeDefined();
      expect(step?.skip?.({} as never)).toMatch(/SHELLKEEP_DEPLOY_ANDROID=1/);
      process.env.SHELLKEEP_DEPLOY_ANDROID = '1';
      expect(step?.skip?.({} as never)).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.SHELLKEEP_DEPLOY_ANDROID;
      else process.env.SHELLKEEP_DEPLOY_ANDROID = previous;
    }
  });

  it('opts a deploy in with SHELLKEEP_DEPLOY_ANDROID', () => {
    createCli(APP_CLI_OPTIONS);
    expect(deployAndroidEnvVar()).toBe('SHELLKEEP_DEPLOY_ANDROID');
  });
});

describe('the TUI brand (#148)', () => {
  afterEach(() => cleanup());

  const at = (columns: number) => ({ loggedIn: false, columns, sectionId: 'root', state: {} });

  it('takes the theme from the Option A tokens', () => {
    expect(APP_CLI_OPTIONS.tuiTheme).toBe(APP_TUI_THEME);
    expect(APP_TUI_THEME.primary).toBe(BRAND.dark.accent);
    expect(APP_TUI_THEME.banner).toBe(BRAND.dark.accent);
    expect(APP_TUI_THEME.brand).toEqual([BRAND.dark.accent, BRAND.dark.accentText]);
    expect(APP_TUI_THEME).toMatchObject({
      error: BRAND.dark.err,
      warning: BRAND.dark.warn,
      success: BRAND.dark.ok,
      info: BRAND.dark.info,
    });
  });

  it('is what resolveTuiTheme picks up once createCli records it', () => {
    createCli(APP_CLI_OPTIONS);
    const theme = resolveTuiTheme({ env: {}, noColor: false });
    expect(theme.color).toBe(true);
    expect(theme.primary).toBe(BRAND.dark.accent);
    expect(theme.error).toBe(BRAND.dark.err);
    expect(theme.brand).toEqual([BRAND.dark.accent, BRAND.dark.accentText]);
  });

  it.each([
    ['NO_COLOR', { env: { NO_COLOR: '1' }, noColor: false }],
    ['--no-color', { env: {}, noColor: true }],
    ['TERM=dumb', { env: { TERM: 'dumb' }, noColor: false }],
  ] as const)('drops every colour under %s', (_label, input) => {
    createCli(APP_CLI_OPTIONS);
    const theme = resolveTuiTheme(input);
    expect(theme.color).toBe(false);
    for (const token of ['primary', 'success', 'warning', 'error', 'info', 'dim', 'accent', 'banner'] as const) {
      expect(theme[token], token).toBeUndefined();
    }
    expect(theme.brand).toEqual([]);
  });

  it('records the root banner and the tagline footnote', () => {
    createCli(APP_CLI_OPTIONS);
    expect(APP_CLI_OPTIONS.tuiMenuRoot).toBe(APP_TUI_MENU_ROOT);
    const { banner, footnote } = getTuiRootMenuSlots();
    expect(resolveTuiMenuSlot(banner, at(80))).toEqual([...APP_WORDMARK]);
    expect(TAGLINE).toBeDefined();
    expect(resolveTuiMenuSlot(footnote, at(80))).toEqual([TAGLINE]);
  });

  it.each([24, 39, 40, 80])('fits the banner in %i columns', (columns) => {
    const lines = resolveTuiMenuSlot(APP_TUI_MENU_ROOT.banner, at(columns));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns);
  });

  it('shows the wordmark from 40 columns and the product name below', () => {
    expect(APP_WORDMARK_MIN_COLUMNS).toBe(40);
    expect(resolveTuiMenuSlot(APP_TUI_MENU_ROOT.banner, at(40))).toEqual([...APP_WORDMARK]);
    expect(resolveTuiMenuSlot(APP_TUI_MENU_ROOT.banner, at(39))).toEqual([APP_NAME]);
    expect(resolveTuiMenuSlot(APP_TUI_MENU_ROOT.banner, at(24))).toEqual([APP_NAME]);
  });

  it.each([
    [40, APP_WORDMARK[1] as string],
    [24, APP_NAME],
  ])('draws the banner on the root menu at %i columns', async (columns, expected) => {
    createCli(APP_CLI_OPTIONS);
    const menu = await renderTuiMenu({ screens: tuiMenuScreens(), loggedIn: false, columns });
    const frame = await menu.waitForFrame((text) => text.includes(expected));
    // Every wordmark line whole (no truncation mark) when it is drawn.
    if (columns >= APP_WORDMARK_MIN_COLUMNS) for (const line of APP_WORDMARK) expect(frame).toContain(line);
    else expect(frame).not.toContain(APP_WORDMARK[1] as string);
    for (const line of stripAnsi(menu.lastFrame() ?? '').split('\n')) expect(line.length).toBeLessThanOrEqual(columns);
  });

  it('draws no colour in the menu with the monochrome theme', async () => {
    createCli(APP_CLI_OPTIONS);
    const menu = await renderTuiMenu({ screens: tuiMenuScreens(), loggedIn: false, columns: 80, theme: 'mono' });
    await menu.waitForFrame((text) => text.includes(APP_WORDMARK[1] as string));
    expect(menu.lastFrame()).not.toMatch(/\u001b\[(3|9)\d/);
  });
});
