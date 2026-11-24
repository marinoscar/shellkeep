// =============================================================================
// ShellKeep's loopback port is 8323  (issue #149)
// =============================================================================
//
// The platform's `deploy install`, `doctor` and `status` default `--port` to
// 3535 and a built-in command's default cannot be changed from an app. ShellKeep
// serves behind the host proxy on 8323, so without `--port 8323` a fresh install
// bound 3535 (or the next free port). The argument vector is completed BEFORE
// it reaches the platform's parser, as KVox's legacy-flag layer does for its own
// translations: an explicit `--port` always wins and is never touched.
//
// `update` takes no `--port`: it reads APP_BIND_PORT from the deployment's
// `.env` (an adopted one included), so it is left alone.
//
// `install --reinstall` and `--resume` are left alone as well. With no `--port`
// the platform keeps the APP_BIND_PORT an existing `.env` already records
// (`settleBindPort`, #1027); an injected, explicit port would override it.
// =============================================================================

/** The loopback port the host proxy forwards to. */
export const DEFAULT_BIND_PORT = 8323;

/** The `deploy` subcommands that take `--port`. */
const PORT_COMMANDS: ReadonlySet<string> = new Set(['install', 'doctor', 'status']);

/** Flags that keep an existing deployment's recorded port in charge. */
const KEEP_RECORDED_PORT: ReadonlySet<string> = new Set(['--reinstall', '--resume']);

/**
 * Adds `--port 8323` to `deploy install|doctor|status` when none was passed.
 *
 * @param argv - The arguments after the executable name.
 * @returns the same vector, or a copy with the default port added; never mutates `argv`.
 */
export function withDefaultPort(argv: readonly string[]): string[] {
  const out = [...argv];
  if (out.includes('-h') || out.includes('--help') || out.includes('-v') || out.includes('--version')) return out;

  const deployAt = out.findIndex((token) => !token.startsWith('-'));
  if (deployAt === -1 || out[deployAt] !== 'deploy') return out;
  const subAt = out.findIndex((token, index) => index > deployAt && !token.startsWith('-'));
  const sub = subAt === -1 ? undefined : out[subAt];
  if (sub === undefined || !PORT_COMMANDS.has(sub)) return out;

  // Only the options of the subcommand: nothing after a bare `--` is an option.
  const end = out.indexOf('--', subAt);
  const options = out.slice(subAt + 1, end === -1 ? out.length : end);
  if (options.some((token) => token === '--port' || token.startsWith('--port='))) return out;
  if (sub === 'install' && options.some((token) => KEEP_RECORDED_PORT.has(token))) return out;

  out.splice(subAt + 1, 0, '--port', String(DEFAULT_BIND_PORT));
  return out;
}
