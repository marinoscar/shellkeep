// =============================================================================
// package_update: the shell a manager needs (issue #62)
// =============================================================================
//
// PURE. Renders the script of a `package_update` step for one package manager. Package names were
// validated by the definition schema and are quoted again here. The script runs as a `command` (strict
// mode, `sudo -n` when the step says so).
//
// `securityOnly`: apt (`unattended-upgrade`, when it is installed) and dnf/yum (`--security`); every
// other manager answers UNSUPPORTED_OPTION. `auto` picks the manager the server's facts (#60) report;
// a server whose facts name none answers PACKAGE_MANAGER_UNKNOWN.
// =============================================================================

import { FAILURE_CODES } from './engine.constants';
import { shellQuote } from './ssh-executor';

export const PACKAGE_MANAGER_NAMES = ['apt', 'dnf', 'yum', 'apk', 'zypper', 'brew'] as const;
export type PackageManagerName = (typeof PACKAGE_MANAGER_NAMES)[number];

export interface PackageUpdateOptions {
  manager: 'auto' | PackageManagerName;
  packages: 'all' | readonly string[];
  refreshIndex: boolean;
  securityOnly: boolean;
}

export type PackageCommandResult =
  | { ok: true; manager: PackageManagerName; script: string }
  | { ok: false; code: typeof FAILURE_CODES.PACKAGE_MANAGER_UNKNOWN | typeof FAILURE_CODES.UNSUPPORTED_OPTION; message: string };

const isManager = (value: unknown): value is PackageManagerName => (PACKAGE_MANAGER_NAMES as readonly unknown[]).includes(value);

export function renderPackageUpdate(options: PackageUpdateOptions, factsManager: string | undefined | null): PackageCommandResult {
  const manager = options.manager === 'auto' ? factsManager : options.manager;
  if (!isManager(manager)) {
    return { ok: false, code: FAILURE_CODES.PACKAGE_MANAGER_UNKNOWN, message: 'No supported package manager was detected on this server' };
  }
  const all = options.packages === 'all';
  const names = all ? '' : (options.packages as readonly string[]).map(shellQuote).join(' ');
  const lines: string[] = [];

  if (options.securityOnly && manager !== 'apt' && manager !== 'dnf' && manager !== 'yum') {
    return { ok: false, code: FAILURE_CODES.UNSUPPORTED_OPTION, message: `securityOnly is not supported for ${manager}` };
  }

  switch (manager) {
    case 'apt': {
      if (options.refreshIndex) lines.push('DEBIAN_FRONTEND=noninteractive apt-get update');
      if (options.securityOnly) {
        if (!all) {
          return { ok: false, code: FAILURE_CODES.UNSUPPORTED_OPTION, message: 'securityOnly on apt updates every security fix; it cannot be limited to named packages' };
        }
        lines.push(
          'if command -v unattended-upgrade >/dev/null 2>&1; then unattended-upgrade -v; else echo "unattended-upgrade is not installed" >&2; exit 1; fi',
        );
      } else if (all) lines.push('DEBIAN_FRONTEND=noninteractive apt-get upgrade -y');
      else lines.push(`DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${names}`);
      break;
    }
    case 'dnf':
    case 'yum': {
      const security = options.securityOnly ? ' --security' : '';
      if (options.refreshIndex) lines.push(`${manager} -y makecache`);
      lines.push(all ? `${manager} -y upgrade${security}` : `${manager} -y upgrade${security} ${names}`);
      break;
    }
    case 'apk':
      if (options.refreshIndex) lines.push('apk update');
      lines.push(all ? 'apk upgrade' : `apk add --upgrade ${names}`);
      break;
    case 'zypper':
      if (options.refreshIndex) lines.push('zypper --non-interactive refresh');
      lines.push(all ? 'zypper --non-interactive update' : `zypper --non-interactive update ${names}`);
      break;
    case 'brew':
      if (options.refreshIndex) lines.push('brew update');
      lines.push(all ? 'brew upgrade' : `brew upgrade ${names}`);
      break;
  }
  return { ok: true, manager, script: lines.join('\n') };
}
