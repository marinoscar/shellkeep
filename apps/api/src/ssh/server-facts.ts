// =============================================================================
// Server facts: the schema and the parser (issue #60)
// =============================================================================
//
// What runbooks (#62) and AI assist (#57) need to know about a server: its kernel,
// OS family, distribution, shell, which tools exist and which package manager it
// uses. Read by ONE exec (`SERVER_FACTS_COMMAND`); parsed here, purely, so the
// parser is proven on captured outputs without a network.
//
// Nothing secret is read: `$SHELL` is a path, `os-release` is public metadata.
// =============================================================================

import { z } from 'zod';

export const SERVER_FACTS_COMMAND =
  'uname -srm; cat /etc/os-release 2>/dev/null; echo "SHELL=$SHELL"; ' +
  'for b in tmux sudo apt-get dnf yum apk zypper brew python3; do command -v $b >/dev/null 2>&1 && echo "HAS=$b"; done';

export const PACKAGE_MANAGERS = ['apt', 'dnf', 'yum', 'apk', 'zypper', 'brew'] as const;

export const serverFactsSchema = z.object({
  kernel: z.string().max(200),
  os: z.enum(['linux', 'darwin', 'freebsd', 'other']),
  distroId: z.string().max(64).optional(),
  distroVersion: z.string().max(64).optional(),
  prettyName: z.string().max(200).optional(),
  shell: z.string().max(200).optional(),
  has: z.array(z.string().max(32)).max(32),
  packageManager: z.enum(PACKAGE_MANAGERS).optional(),
});

export type ServerFacts = z.infer<typeof serverFactsSchema>;

/** The probe `HAS=` name for each package manager, in the order they win. */
const MANAGER_BINARIES: ReadonlyArray<readonly [(typeof PACKAGE_MANAGERS)[number], string]> = [
  ['apt', 'apt-get'],
  ['dnf', 'dnf'],
  ['yum', 'yum'],
  ['apk', 'apk'],
  ['zypper', 'zypper'],
  ['brew', 'brew'],
];

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parses the output of {@link SERVER_FACTS_COMMAND}. Throws when it has no kernel line. */
export function parseServerFacts(stdout: string): ServerFacts {
  const lines = stdout.split(/\r?\n/);
  const kernelLine = lines.find((line) => line.trim().length > 0);
  if (!kernelLine) throw new Error('The server returned no output for the facts probe');

  const kernel = kernelLine.trim().slice(0, 200);
  const family = kernel.split(/\s+/)[0]?.toLowerCase() ?? '';
  const os: ServerFacts['os'] = family === 'linux' || family === 'darwin' || family === 'freebsd' ? family : 'other';

  const release: Record<string, string> = {};
  const has: string[] = [];
  let shell: string | undefined;
  for (const raw of lines.slice(lines.indexOf(kernelLine) + 1)) {
    const line = raw.trim();
    if (line.startsWith('HAS=')) {
      const name = line.slice(4);
      if (/^[a-z0-9_-]{1,32}$/i.test(name) && !has.includes(name)) has.push(name);
    } else if (line.startsWith('SHELL=')) {
      const value = line.slice(6).trim();
      if (value) shell = value.slice(0, 200);
    } else {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
      if (match) release[match[1]] = unquote(match[2]);
    }
  }

  const packageManager = MANAGER_BINARIES.find(([, binary]) => has.includes(binary))?.[0];
  const facts: ServerFacts = { kernel, os, has: has.slice(0, 32) };
  if (release.ID) facts.distroId = release.ID.slice(0, 64);
  if (release.VERSION_ID) facts.distroVersion = release.VERSION_ID.slice(0, 64);
  if (release.PRETTY_NAME) facts.prettyName = release.PRETTY_NAME.slice(0, 200);
  if (shell) facts.shell = shell;
  if (packageManager) facts.packageManager = packageManager;
  return serverFactsSchema.parse(facts);
}
