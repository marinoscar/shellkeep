// =============================================================================
// Dry run: the read-only probes of each step kind (issue #67)
// =============================================================================
//
// PURE. A dry run connects to every target (the host key and the credential are verified exactly as in a
// real run), refreshes its facts and then, per step, sends ONE probe script that changes nothing:
//
//   command          `bash -n` (syntax) and `command -v <argv0>` for each binary the command names
//   script           `bash -n` / `sh -n`, or `python3 -m py_compile` on a temp file that is deleted
//   package_update   the manager's simulation: `apt-get -s`, `dnf|yum --assumeno`, `apk --simulate`,
//                    `zypper --dry-run`; brew has none (the step is skipped)
//   file_upload      `test -d` / `test -w` on the destination directory and `test -e` on the file
//   collect_logs     `ls -la` of the paths, estimated against the caps
//   ai_task, approval_gate   not simulated (skipped)
//
// THE ALLOWLIST. The only commands a probe contains are the ones above, plus `echo`, `exit`, `rc=` and the
// heredoc that carries the user's text to `bash -n` as DATA (it is never executed). Every probe starts with
// `PROBE_MARKER`; the real-shell spec asserts this allowlist against what the SSH fixture received.
//
// A step that cannot run for a reason the real run would report (an unknown package manager, an option the
// manager lacks) fails with that same code. Nothing here logs or returns a secret: parameters and secrets
// travel in the executor's environment exports, never in the probe text.
// =============================================================================

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import type { RunbookStep } from '../schema/runbook-definition.schema';
import { FAILURE_CODES, type FailureCode } from './engine.constants';
import { renderPackageUpdate } from './package-commands';
import { shellQuote } from './ssh-executor';

/** The first line of every probe script. */
export const PROBE_MARKER = '# shellkeep dry-run probe';

export type DryRunPlan =
  | { kind: 'skip'; reason: string }
  | { kind: 'fail'; code: FailureCode; message: string }
  | {
      kind: 'probe';
      /** The script sent over `bash -s`. */
      script: string;
      /** What the step would do, one line each (shown in the log, redacted by the caller). */
      preview: string[];
      /** Exit codes that mean "would run". */
      okExitCodes: readonly number[];
      /** Which interpreter the real step uses: the probe needs it present. */
      note?: string;
    };

const SHELL_WORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'select', 'time', '!',
  'echo', 'printf', 'cd', 'export', 'set', 'unset', 'read', 'exit', 'return', 'source', '.', 'eval', 'exec', 'trap', 'wait', 'shift',
  'local', 'declare', 'typeset', 'readonly', 'alias', 'unalias', 'true', 'false', ':', 'break', 'continue', 'let', 'umask', 'ulimit',
  'pwd', 'pushd', 'popd', 'type', 'hash', 'getopts', 'test', '[', '[[', 'command', 'builtin', 'bg', 'fg', 'jobs', 'history', 'in',
]);
const CONTROL_PREFIX = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!']);
const WRAPPERS = new Set(['sudo', 'env', 'nohup', 'time', 'exec', 'command', 'nice', 'ionice', 'timeout', 'stdbuf']);
const BINARY_NAME = /^[A-Za-z0-9._+/-]+$/;
const MAX_BINARIES = 20;

/** A delimiter that occurs nowhere in `text`. */
export function freshDelimiter(text: string, seed: string): string {
  let delimiter = `SK_DRY_${createHash('sha256').update(seed + text.length).digest('hex').slice(0, 12)}`;
  while (text.includes(delimiter)) delimiter += 'X';
  return delimiter;
}

/** Splits shell text into simple-command word lists: quote-aware, on `;` `&` `|` `(` `)` `{` `}` and newlines. */
function simpleCommands(text: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let hasWord = false;
  const endWord = (): void => {
    if (hasWord) words.push(word);
    word = '';
    hasWord = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        word += text[(i += 1)]!;
      } else word += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '\n') {
        i += 1; // a line continuation joins the lines
        continue;
      }
      word += text[(i += 1)]!;
      hasWord = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasWord = true;
    } else if (ch === '#' && !hasWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1; // a comment
    } else if (/\s/.test(ch) && ch !== '\n') endWord();
    else if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')' || ch === '{' || ch === '}') endCommand();
    else {
      word += ch;
      hasWord = true;
    }
  }
  endCommand();
  return commands;
}

/**
 * The binaries a command text names (the first word of each simple command), for `command -v`. A word that
 * is a shell keyword or builtin, an assignment, an expansion or a path of unknown shape is not a binary
 * worth probing. Scanning stops at the first heredoc: its body is data.
 */
export function commandBinaries(text: string): string[] {
  const heredoc = text.search(/<<-?\s*['"]?\w/);
  const scanned = heredoc === -1 ? text : text.slice(0, text.indexOf('\n', heredoc) === -1 ? text.length : text.indexOf('\n', heredoc));
  const found: string[] = [];
  for (const words of simpleCommands(scanned)) {
    let index = 0;
    while (index < words.length) {
      const word = words[index]!;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || CONTROL_PREFIX.has(word)) index += 1;
      else if (WRAPPERS.has(word)) {
        index += 1;
        // a wrapper's own flags (and a flag's value for `sudo -u user`, `timeout 5`) are not the command
        while (index < words.length && (words[index]!.startsWith('-') || /^\d+[smhd]?$/.test(words[index]!))) {
          const flag = words[index]!;
          index += 1;
          if (word === 'sudo' && (flag === '-u' || flag === '-g') && index < words.length) index += 1;
        }
      } else break;
    }
    const name = words[index];
    if (!name || SHELL_WORDS.has(name) || !BINARY_NAME.test(name) || name.includes('$')) continue;
    if (!found.includes(name)) found.push(name);
    if (found.length >= MAX_BINARIES) break;
  }
  return found;
}

const probe = (script: string, preview: string[], okExitCodes: readonly number[] = [0]): DryRunPlan => ({
  kind: 'probe',
  script: `${PROBE_MARKER}\n${script}\n`,
  preview,
  okExitCodes,
});

const present = (binary: string): string =>
  `command -v -- ${shellQuote(binary)} >/dev/null 2>&1 && echo ${shellQuote(`found: ${binary}`)} || { echo ${shellQuote(`missing: ${binary}`)} >&2; rc=1; }`;

/** A heredoc that hands `body` to `interpreter -n` as data, as the condition of an `if`. */
function syntaxCheck(interpreter: 'bash' | 'sh', body: string, seed: string): string {
  const delimiter = freshDelimiter(body, seed);
  return [`if ${interpreter} -n <<'${delimiter}'`, body, delimiter, `then echo "syntax: ok"; else echo "syntax: error" >&2; rc=1; fi`].join('\n');
}

/**
 * A glob-aware quote: `* ? [ ]` stay live so the shell lists the matches; every other character that is not
 * plainly safe is backslash-escaped, so a path can never carry a command. `null` for a control character.
 */
export function globQuote(path: string): string | null {
  let out = '';
  for (const ch of path) {
    if (/[\u0000-\u001f\u007f]/.test(ch)) return null;
    out += /[A-Za-z0-9/._+,@:=%~*?[\]-]/.test(ch) ? ch : `\\${ch}`;
  }
  return out;
}

function packageSimulation(step: Extract<RunbookStep, { kind: 'package_update' }>, factsManager: string | undefined | null): DryRunPlan {
  const rendered = renderPackageUpdate(step, factsManager);
  if (!rendered.ok) return { kind: 'fail', code: rendered.code, message: rendered.message };
  const all = step.packages === 'all';
  const names = all ? '' : (step.packages as readonly string[]).map(shellQuote).join(' ');
  const preview = [`Would run on ${rendered.manager}: ${rendered.script.split('\n').join(' ; ')}`];
  switch (rendered.manager) {
    case 'apt': {
      if (step.securityOnly) {
        return probe(
          'rc=0\nif command -v unattended-upgrade >/dev/null 2>&1; then unattended-upgrade --dry-run -v; rc=$?; else echo "unattended-upgrade is not installed" >&2; rc=1; fi\nexit $rc',
          preview,
        );
      }
      const line = all ? 'DEBIAN_FRONTEND=noninteractive apt-get -s upgrade' : `DEBIAN_FRONTEND=noninteractive apt-get -s install --only-upgrade ${names}`;
      return probe(`${line}\nexit $?`, preview);
    }
    case 'dnf':
    case 'yum': {
      const security = step.securityOnly ? ' --security' : '';
      // `--assumeno` answers "no" to the transaction and exits 1 when there is something to update.
      return probe(`${rendered.manager} --assumeno upgrade${security}${all ? '' : ` ${names}`}\nexit $?`, preview, [0, 1]);
    }
    case 'apk':
      return probe(`${all ? 'apk upgrade --simulate' : `apk add --upgrade --simulate ${names}`}\nexit $?`, preview);
    case 'zypper':
      return probe(`zypper --non-interactive update --dry-run${all ? '' : ` ${names}`}\nexit $?`, preview);
    case 'brew':
      return { kind: 'skip', reason: 'brew has no dry-run mode' };
  }
}

/** The probe of one step. `seed` makes the heredoc delimiters unique per probe (any string). */
export function planDryRunStep(step: RunbookStep, context: { factsManager?: string | null | undefined; seed: string }): DryRunPlan {
  switch (step.kind) {
    case 'command': {
      const binaries = commandBinaries(step.command);
      const lines = ['rc=0', syntaxCheck('bash', step.command, context.seed), ...binaries.map(present), 'exit $rc'];
      return probe(lines.join('\n'), [`Would run: ${step.command}`], [0]);
    }
    case 'script': {
      const preview = [`Would run a ${step.interpreter} script (${step.body.split('\n').length} lines)`];
      if (step.interpreter === 'python3') {
        const delimiter = freshDelimiter(step.body, context.seed);
        const lines = [
          'rc=0',
          'f="$(mktemp)" || exit 1',
          `trap 'rm -f -- "$f" "$f.pyc"' EXIT`,
          `cat > "$f" <<'${delimiter}'`,
          step.body,
          delimiter,
          `if python3 -c 'import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[1] + ".pyc", doraise=True)' "$f"; then echo "syntax: ok"; else echo "syntax: error" >&2; rc=1; fi`,
          'exit $rc',
        ];
        return probe(lines.join('\n'), preview);
      }
      return probe(['rc=0', syntaxCheck(step.interpreter, step.body, context.seed), present(step.interpreter), 'exit $rc'].join('\n'), preview);
    }
    case 'package_update':
      return packageSimulation(step, context.factsManager);
    case 'file_upload': {
      const dir = shellQuote(posix.dirname(step.destPath));
      const file = shellQuote(step.destPath);
      const lines = [
        'rc=0',
        `d=${dir}`,
        `f=${file}`,
        'if test -d "$d"; then echo "directory exists"; else echo "directory missing" >&2; rc=1; fi',
        'if test -w "$d"; then echo "directory writable"; else echo "directory not writable" >&2; rc=1; fi',
        step.overwrite
          ? 'if test -e "$f"; then echo "destination exists: would be replaced"; else echo "destination does not exist"; fi'
          : 'if test -e "$f"; then echo "destination exists and overwrite is off" >&2; rc=1; else echo "destination does not exist"; fi',
        'exit $rc',
      ];
      return probe(lines.join('\n'), [`Would upload a stored file to ${step.destPath}${step.overwrite ? ' (overwriting)' : ''}`]);
    }
    case 'collect_logs': {
      const quoted = step.paths.map(globQuote);
      if (quoted.some((q) => q === null)) return { kind: 'fail', code: FAILURE_CODES.DRY_RUN_PRECONDITION, message: 'A path contains a control character' };
      const preview = [`Would collect ${step.paths.length} path(s)${step.journalUnits.length > 0 ? ` and ${step.journalUnits.length} journal unit(s) (journal units are not simulated)` : ''}`];
      if (step.paths.length === 0) return probe('exit 0', preview);
      return probe(`ls -la -- ${quoted.join(' ')}\nexit $?`, preview);
    }
    case 'ai_task':
    case 'approval_gate':
      return { kind: 'skip', reason: 'not simulated' };
  }
}

export interface LogCollectionEstimate {
  files: number;
  totalBytes: number;
  /** Files larger than `maxBytesPerFile` (they would be cut). */
  oversized: number;
  overTotal: boolean;
}

/** Sums the regular files of an `ls -la` listing against the step's caps. */
export function estimateLogCollection(listing: string, caps: { maxBytesPerFile: number; maxTotalBytes: number }): LogCollectionEstimate {
  let files = 0;
  let totalBytes = 0;
  let oversized = 0;
  for (const line of listing.split('\n')) {
    const match = /^-[rwxsStT-]{9}[.+@]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s/.exec(line);
    if (!match) continue;
    const size = Number(match[1]);
    files += 1;
    totalBytes += size;
    if (size > caps.maxBytesPerFile) oversized += 1;
  }
  return { files, totalBytes, oversized, overTotal: totalBytes > caps.maxTotalBytes };
}
