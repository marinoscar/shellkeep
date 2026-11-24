import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

// =============================================================================
// Which deployment does a `deploy` command mean?  (issue #150)
// =============================================================================
//
// The platform CLI resolves the deployment a `deploy` command acts on with five
// ranks (`--root`, `--name`, the directory the shell stands in, the sole
// installed deployment, refuse). Its resolver (`locateApp`) is internal to the
// package as of 0.1.0-next.39 and is not exported, but the two extensions that
// run BEFORE the platform's command (the `uninstall --confirm` guard and
// `update --check`) need the same answer. This module restates the ranks. It
// is deliberately the same order and the same refusal on ambiguity: one of its
// callers gates a destructive command, so when it cannot be sure which
// deployment is meant it says so instead of choosing.
//
// PLATFORM-ADOPTION-SHIM(#150): a copy of an internal of the platform package;
// removed when the package exports its resolver.
//
// What counts as a deployment is the platform's rule (`isDeployment`): a git
// checkout at `repo/` and a readable environment file (`.env`, or the one an
// older CLI left inside the checkout). The state file is deliberately not part
// of it: a server installed before any record was written is still one.
// =============================================================================

/** The apps root every `deploy` command defaults to. Mirrors the platform's default. */
export const DEFAULT_APPS_ROOT = '/opt/infra/apps';

/** The deployment-selecting options of a `deploy` command. */
export interface DeploymentSelector {
  root?: string | undefined;
  name?: string | undefined;
  appsRoot?: string | undefined;
  cwd: string;
}

/** A resolved deployment. */
export interface ResolvedDeployment {
  name: string;
  deployRoot: string;
  appsRoot: string;
}

/** Why a deployment could not be resolved; the message names the way out. */
export class DeploymentResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentResolutionError';
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The environment file of a deployment: the current location, else the one inside the checkout. */
export function resolveEnvPath(deployRoot: string): string | undefined {
  for (const candidate of [join(deployRoot, '.env'), join(deployRoot, 'repo', 'infra', 'compose', '.env')]) {
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function isDeployment(dir: string): boolean {
  return existsSync(join(dir, 'repo', '.git')) && resolveEnvPath(dir) !== undefined;
}

function listDeployments(appsRoot: string): string[] {
  // The apps root may itself be a deployment (the platform allows it).
  if (isDeployment(appsRoot)) return [basename(appsRoot)];
  let entries: string[];
  try {
    entries = readdirSync(appsRoot);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      const dir = join(appsRoot, entry);
      try {
        return statSync(dir).isDirectory() && isDeployment(dir);
      } catch {
        return false;
      }
    })
    .sort();
}

/** The deployment a directory stands in, walking up but never past the apps root. */
function deploymentContaining(cwd: string, appsRoot: string): string | undefined {
  let current = resolve(cwd);
  while (current.startsWith(appsRoot)) {
    if (isDeployment(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Resolves the deployment in the platform's rank order.
 *
 * @throws DeploymentResolutionError when none is installed or several are and
 *   nothing says which.
 */
export function resolveDeployment(selector: DeploymentSelector): ResolvedDeployment {
  const appsRoot = resolve(selector.appsRoot ?? DEFAULT_APPS_ROOT);

  if (selector.root !== undefined) {
    const deployRoot = resolve(selector.cwd, selector.root);
    return {
      name: basename(deployRoot),
      deployRoot,
      appsRoot: isAbsolute(selector.root) ? dirname(deployRoot) : appsRoot,
    };
  }

  if (selector.name !== undefined) {
    return { name: selector.name, deployRoot: join(appsRoot, selector.name), appsRoot };
  }

  const standing = deploymentContaining(selector.cwd, appsRoot);
  if (standing !== undefined) return { name: basename(standing), deployRoot: standing, appsRoot };

  const found = listDeployments(appsRoot);
  if (found.length === 1 && found[0] !== undefined) {
    const only = found[0];
    const deployRoot = isDeployment(appsRoot) ? appsRoot : join(appsRoot, only);
    return { name: only, deployRoot, appsRoot };
  }
  if (found.length === 0) {
    throw new DeploymentResolutionError(
      `No deployment found under ${appsRoot}. Pass --root to point at one somewhere else, or run install first.`,
    );
  }
  throw new DeploymentResolutionError(
    `Several deployments are installed under ${appsRoot}: ${found.join(', ')}. Pass --name to choose one, or run this from inside the one you mean.`,
  );
}
