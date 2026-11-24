import { backupEnvFile, confirmationProblem } from './uninstall-guard.js';
import { DeploymentResolutionError, resolveDeployment, type ResolvedDeployment } from './deployment.js';

// =============================================================================
// What runs around the platform's `deploy` commands  (issue #150)
// =============================================================================
//
// The platform's `deploy uninstall` has no typed confirmation and no
// environment backup, and its `deploy update` has no `--check`. This module
// looks at the argument vector BEFORE it reaches the platform's parser and
// answers one of:
//
//   run      hand `argv` to the platform CLI, after running `before` (the
//            environment backup) and printing `notes` on stderr;
//   refuse   print `message` and exit with the usage code;
//   update-check  answer `deploy update --check` itself (extensions/update-check.ts).
//
// Help and version are never inspected: they must describe the real surface.
// =============================================================================

/** A value-taking flag this layer reads; every other flag is passed through untouched. */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--root', '--apps-root', '--name', '--ref', '--confirm']);

/** What to do with an invocation. */
export type DeployPlan =
  | {
      kind: 'run';
      /** What to hand the platform CLI. */
      argv: string[];
      /** One line each, for stderr, before the command runs. */
      notes: string[];
      /** Work to do first (the environment backup); each returns a line to print. */
      before: Array<() => string | undefined>;
    }
  | { kind: 'refuse'; message: string }
  | {
      kind: 'update-check';
      selector: { root?: string | undefined; name?: string | undefined; appsRoot?: string | undefined };
      ref?: string | undefined;
      json: boolean;
    };

/** What {@link planDeployArgs} needs from the process. */
export interface DeployPlanContext {
  /** The executable's name, for messages. */
  cli: string;
  cwd: string;
  now?: (() => Date) | undefined;
}

interface Item {
  /** The raw tokens this item came from (a flag and its value, or one positional). */
  tokens: string[];
  flag?: string | undefined;
  value?: string | undefined;
}

function scan(tokens: readonly string[]): Item[] {
  const items: Item[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === '--') {
      items.push({ tokens: tokens.slice(index) });
      break;
    }
    if (!token.startsWith('--')) {
      items.push({ tokens: [token] });
      continue;
    }
    const equals = token.indexOf('=');
    const flag = equals === -1 ? token : token.slice(0, equals);
    if (equals !== -1) {
      items.push({ tokens: [token], flag, value: token.slice(equals + 1) });
    } else if (VALUE_FLAGS.has(flag) && index + 1 < tokens.length) {
      items.push({ tokens: [token, tokens[index + 1] as string], flag, value: tokens[index + 1] as string });
      index += 1;
    } else {
      items.push({ tokens: [token], flag });
    }
  }
  return items;
}

function valueOf(items: readonly Item[], flag: string): string | undefined {
  return items.find((item) => item.flag === flag)?.value;
}

function has(items: readonly Item[], flag: string): boolean {
  return items.some((item) => item.flag === flag);
}

/**
 * Plans one `deploy` invocation.
 *
 * Pure apart from what it is handed: it reads the filesystem only to resolve
 * the deployment an `uninstall` means (and only for a real one), and the
 * environment backup is returned as work for the caller to run, not run here.
 *
 * @param argv - The arguments after the executable name.
 * @param context - The executable's name, the working directory, the clock.
 */
export function planDeployArgs(argv: readonly string[], context: DeployPlanContext): DeployPlan {
  const passthrough: DeployPlan = { kind: 'run', argv: [...argv], notes: [], before: [] };

  // Help and version are never inspected: they must describe the real surface.
  if (argv.includes('-h') || argv.includes('--help') || argv.includes('-v') || argv.includes('--version')) {
    return passthrough;
  }

  const deployAt = argv.findIndex((token) => !token.startsWith('-'));
  if (deployAt === -1 || argv[deployAt] !== 'deploy') return passthrough;
  const subAt = argv.findIndex((token, index) => index > deployAt && !token.startsWith('-'));
  const sub = subAt === -1 ? undefined : argv[subAt];
  if (sub === undefined) return passthrough;

  const head = argv.slice(0, subAt + 1);
  const items = scan(argv.slice(subAt + 1));

  if (sub === 'update' && has(items, '--check')) {
    return {
      kind: 'update-check',
      selector: {
        root: valueOf(items, '--root'),
        name: valueOf(items, '--name'),
        appsRoot: valueOf(items, '--apps-root'),
      },
      ref: valueOf(items, '--ref'),
      json: has(items, '--json'),
    };
  }

  if (sub === 'uninstall') {
    const before: Array<() => string | undefined> = [];
    const problem = guardUninstall(items, context, before);
    if (problem !== undefined) return { kind: 'refuse', message: problem };
    // The platform's uninstall has no `--confirm`; it is consumed here.
    const kept = items.filter((item) => item.flag !== '--confirm');
    return { kind: 'run', argv: [...head, ...kept.flatMap((item) => item.tokens)], notes: [], before };
  }

  return passthrough;
}

function guardUninstall(
  items: readonly Item[],
  context: DeployPlanContext,
  before: Array<() => string | undefined>,
): string | undefined {
  // A dry run changes nothing, so it needs no confirmation and takes no backup.
  if (has(items, '--dry-run')) return undefined;

  let deployment: ResolvedDeployment;
  try {
    deployment = resolveDeployment({
      root: valueOf(items, '--root'),
      name: valueOf(items, '--name'),
      appsRoot: valueOf(items, '--apps-root'),
      cwd: context.cwd,
    });
  } catch (error) {
    if (error instanceof DeploymentResolutionError) return `${context.cli}: ${error.message}`;
    throw error;
  }

  const problem = confirmationProblem(context.cli, deployment.name, valueOf(items, '--confirm'));
  if (problem !== undefined) return problem;

  before.push(() => {
    const backup = backupEnvFile(deployment, context.now?.() ?? new Date());
    return backup === undefined
      ? undefined
      : `${context.cli}: note: copied ${backup.source} to ${backup.path} (mode 0600) before it is removed.`;
  });
  return undefined;
}
