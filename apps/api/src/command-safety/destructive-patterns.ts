// =============================================================================
// The command-risk table (issue #56)
// =============================================================================
//
// DATA, not logic: #67 (runbook approvals) extends this list. A row matches a
// single command line (after the leading `sudo`/`env` wrappers are kept in the
// text; the patterns allow them). `destructive` rows are `high` risk; the rest
// are `medium`.
//
// Known, accepted false positives: the table works on text, so a quoted mention
// (`echo "rm -rf /"`) matches. Such a line is reported `medium`, never `high`
// (see `classify-command.ts`).
// =============================================================================

export interface CommandRiskPattern {
  /** Stable id, shown nowhere to end users; keeps the table testable. */
  id: string;
  re: RegExp;
  /** Human-readable reason, returned in `reasons`. */
  reason: string;
  /** `true`: data or availability loss, risk `high`. `false`: risk `medium` (or `high` for a `HIGH_PATTERNS` row). */
  destructive: boolean;
}

/**
 * A shell variable reference that is the WHOLE path (optionally followed by `/` and `*`). `${X:?msg}` and
 * `${X:-default}` are guarded expansions and are deliberately not matched.
 */
const VARIABLE = String.raw`\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)`;

const RM_RECURSIVE = String.raw`\brm\s+(?:-[a-zA-Z]*\s+)*?(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b(?:\s+-[-a-zA-Z]+)*`;

export const DESTRUCTIVE_PATTERNS: readonly CommandRiskPattern[] = [
  {
    id: 'rm_root',
    re: new RegExp(`${RM_RECURSIVE}\\s+(?:--no-preserve-root\\s+)?(?:/\\*?|~/?\\*?|\\$HOME/?\\*?)(?=\\s|$|;|&|\\|)`),
    reason: 'Recursive delete of the filesystem root or the home directory',
    destructive: true,
  },
  { id: 'mkfs', re: /\bmkfs(?:\.\w+)?\b/, reason: 'Creates a filesystem, erasing the device', destructive: true },
  { id: 'dd_device', re: /\bdd\b[^\n]*\bof=\/dev\//, reason: 'dd writes to a device', destructive: true },
  { id: 'wipefs', re: /\bwipefs\b/, reason: 'Erases filesystem signatures', destructive: true },
  { id: 'shred', re: /\bshred\b/, reason: 'Irrecoverably overwrites files or devices', destructive: true },
  { id: 'redirect_device', re: />\s*\/dev\/(?:sd|hd|vd|nvme|xvd)[a-z0-9]*/, reason: 'Redirects output onto a disk device', destructive: true },
  { id: 'fork_bomb', re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork bomb', destructive: true },
  {
    id: 'chmod_root',
    re: /\bchmod\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*R[a-zA-Z]*\s+(?:0?777|a\+rwx)\s+\/(?=\s|$|;|&|\|)/,
    reason: 'Recursive world-writable permissions on /',
    destructive: true,
  },
  {
    id: 'chown_root',
    re: /\bchown\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*R[a-zA-Z]*\s+\S+\s+\/(?=\s|$|;|&|\|)/,
    reason: 'Recursive ownership change on /',
    destructive: true,
  },
  { id: 'shutdown', re: /\b(?:shutdown|reboot|halt|poweroff)\b/, reason: 'Shuts down or reboots the host', destructive: true },
  { id: 'init_runlevel', re: /\binit\s+[06]\b/, reason: 'Changes to the halt or reboot runlevel', destructive: true },
  {
    id: 'stop_sshd',
    re: /\bsystemctl\s+(?:stop|disable|mask)\s+(?:sshd?)(?:\.service)?\b/,
    reason: 'Stops or disables the SSH service, which can lock you out',
    destructive: true,
  },
  { id: 'iptables_flush', re: /\biptables\s+(?:-t\s+\w+\s+)?(?:-F|--flush)\b/, reason: 'Flushes firewall rules', destructive: true },
  { id: 'nft_flush', re: /\bnft\s+flush\b/, reason: 'Flushes firewall rules', destructive: true },
  { id: 'ufw_disable', re: /\bufw\s+disable\b/, reason: 'Disables the firewall', destructive: true },
  { id: 'userdel', re: /\buserdel\b/, reason: 'Deletes a user account', destructive: true },
  { id: 'passwd_delete', re: /\bpasswd\s+(?:-\w+\s+)*-d\b/, reason: 'Deletes a password', destructive: true },
  { id: 'sql_drop', re: /\bDROP\s+(?:DATABASE|TABLE)\b/i, reason: 'Drops a database or table', destructive: true },
  { id: 'sql_truncate', re: /\bTRUNCATE\b/i, reason: 'Truncates a table', destructive: true },
  {
    id: 'kubectl_delete',
    re: /\bkubectl\s+delete\s+(?:(?:ns|namespaces?)\b|[^\n]*--all\b)/,
    reason: 'Deletes a Kubernetes namespace or every resource of a kind',
    destructive: true,
  },
  { id: 'docker_prune', re: /\bdocker\s+system\s+prune\b[^\n]*(?:-a\b|--all\b)/, reason: 'Removes all unused Docker data', destructive: true },
  { id: 'git_force_push', re: /\bgit\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b)/, reason: 'Force-pushes and can overwrite remote history', destructive: true },
  // ---- Runbook rows (#67) -------------------------------------------------------------------------
  {
    id: 'rm_unquoted_variable',
    re: new RegExp(`${RM_RECURSIVE}\\s+(?:--\\s+)?${VARIABLE}/?\\*?(?=\\s|$|;|&|\\|)`),
    reason: 'Recursive delete of an unquoted variable path: an unset variable expands to /',
    destructive: true,
  },
  {
    id: 'find_delete_root',
    re: /\bfind\s+(?:-[HLPD]\w*\s+)*\/(?=\s)[^\n;&|]*\s-delete\b/,
    reason: 'find -delete starting at the filesystem root',
    destructive: true,
  },
  {
    id: 'truncate_var_lib',
    re: /\btruncate\s+[^\n;&|]*(?:-s\s*0|--size[=\s]0)(?=\s|$)[^\n;&|]*\s\/var\/lib\/[^\s;&|]*/,
    reason: 'Truncates files under /var/lib to zero bytes',
    destructive: true,
  },
  { id: 'pipe_to_shell', re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/, reason: 'Downloads and runs a script unreviewed', destructive: true },
];

export const MEDIUM_PATTERNS: readonly CommandRiskPattern[] = [
  { id: 'sudo', re: /(?:^|[\s;&|(])sudo\b/, reason: 'Runs with elevated privileges', destructive: false },
  {
    id: 'package_removal',
    re: /\b(?:apt(?:-get)?\s+(?:remove|purge|autoremove)|yum\s+(?:remove|erase)|dnf\s+(?:remove|erase)|apk\s+del|pacman\s+-R\w*|brew\s+(?:uninstall|remove)|pip\d?\s+uninstall|npm\s+(?:uninstall|remove|rm))\b/,
    reason: 'Removes packages',
    destructive: false,
  },
  {
    id: 'service_restart',
    re: /\b(?:systemctl\s+(?:restart|stop|reload|disable)|service\s+\S+\s+(?:restart|stop)|rc-service\s+\S+\s+(?:restart|stop))\b/,
    reason: 'Restarts or stops a service',
    destructive: false,
  },
  { id: 'rm_recursive', re: new RegExp(RM_RECURSIVE), reason: 'Recursive delete', destructive: false },
  { id: 'kill_all', re: /\b(?:killall|pkill)\b/, reason: 'Kills processes by name', destructive: false },
];

/**
 * Rows that are `high` risk but not destructive: they need a human's eye, not a confirmation gate on their
 * own. A quoted variable path still deletes everything when the variable is empty, but a strict shell
 * (`set -u`, which command and bash steps run under) stops on an unset one.
 */
export const HIGH_PATTERNS: readonly CommandRiskPattern[] = [
  {
    id: 'rm_quoted_variable',
    re: new RegExp(`${RM_RECURSIVE}\\s+(?:--\\s+)?(?:"${VARIABLE}/?\\*?"|"${VARIABLE}/?"\\*?|"${VARIABLE}"/\\*?)(?=\\s|$|;|&|\\|)`),
    reason: 'Recursive delete of a variable path: make sure the variable is set',
    destructive: false,
  },
];
