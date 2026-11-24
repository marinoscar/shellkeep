// =============================================================================
// The SSH executor (issue #62)
// =============================================================================
//
// Runs ONE script on an already verified connection (`SshConnectionFactory.open`, host key checked
// before any credential) and streams its output. What it sends and what it never sends:
//
//   argv      EXACTLY `bash -s` (`sh -s`, `python3 -`; with `runAs.sudo`: `sudo -n [-u user] bash -s`).
//             The user's command, its parameters and every secret travel on STDIN, never in argv, which
//             any local user could read from the process list of the target.
//   stdin     a prelude (strict mode for `command` and `bash`, `export NAME=<quoted>` for parameters and
//             secrets, `cd -- <workdir>`), the body, then EOF.
//
// The body of a shell script is handed to `eval` through a quoted heredoc. With a plain `bash -s` a
// command that reads standard input (`cat`, `read`, `ssh`) would swallow the rest of the script; here the
// whole body is already parsed when it runs, and it sees EOF.
//
// TIMEOUT AND CANCEL: `channel.signal('INT')`, then `KILL` after 10 seconds, then the channel is closed.
// The step ends `timed_out` or `cancelled`.
//
// The exit code comes from the channel's `exit` event; success means it is one of `successExitCodes`
// (the caller decides: this only reports).
//
// `sudo -n` never prompts; a `a password is required` on stderr is reported as `sudoPasswordRequired`.
//
// NOTHING HERE LOGS, TRACES OR THROWS A COMMAND OR A VALUE. The span carries the step kind and index,
// the server profile id, the exit code and the command's sha256.
// =============================================================================

import { createHash } from 'node:crypto';

import { SpanStatusCode, trace } from '@opentelemetry/api';
import { Injectable } from '@nestjs/common';
import type { Client, ClientChannel } from 'ssh2';

const tracer = trace.getTracer('shellkeep.runbooks');

export type Interpreter = 'bash' | 'sh' | 'python3';

export interface ExecChunk {
  stream: 'stdout' | 'stderr';
  data: Buffer;
}

export interface SshExecRequest {
  /** The command or script body. */
  script: string;
  interpreter?: Interpreter;
  /** `command` steps and bash scripts run under `set -euo pipefail`. */
  strict?: boolean;
  /** Parameters, exported as environment variables. */
  env?: Readonly<Record<string, string>>;
  /** Secrets, exported the same way (kept apart so callers can redact them). */
  secrets?: Readonly<Record<string, string>>;
  /** Positional arguments of a script. */
  args?: readonly string[];
  runAs?: { sudo?: boolean; user?: string };
  workdir?: string;
  timeoutSec: number;
  onChunk: (chunk: ExecChunk) => void;
  signal?: AbortSignal;
  /** Stop delivering chunks after this many bytes (the rest is drained); `truncated` says so. */
  maxBytes?: number;
  /** Span attributes: ids and kinds, never text. */
  span?: { stepKind: string; stepIndex: number; serverProfileId: string };
}

export interface SshExecResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** The abort signal fired (a cancel). */
  aborted: boolean;
  bytes: number;
  truncated: boolean;
  sudoPasswordRequired: boolean;
  /** sha256 of the script text (the same value the audit row stores). */
  commandSha256: string;
}

/** Grace between INT and KILL, and between KILL and closing the channel. */
export const KILL_GRACE_MS = 10_000;
const FORCE_CLOSE_GRACE_MS = 2_000;

/** POSIX single-quote quoting: safe for any value, including quotes and newlines. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The exec line a request sends: never carries the script, a parameter or a secret. */
export function execCommandLine(request: Pick<SshExecRequest, 'interpreter' | 'runAs'>): string {
  const interpreter = request.interpreter ?? 'bash';
  const base = interpreter === 'python3' ? 'python3 -' : `${interpreter} -s`;
  if (!request.runAs?.sudo) return base;
  return `sudo -n${request.runAs.user ? ` -u ${request.runAs.user}` : ''} ${base}`;
}

/**
 * Sends an SSH `signal` request. ssh2's public `channel.signal()` does nothing once the channel has sent EOF
 * (its state is no longer `open`), and a script needs EOF (`python3 -` reads its whole stdin before it runs;
 * `bash -s` needs it to end). The request itself is valid on a half-closed channel, so after EOF it is sent
 * through the channel's own protocol object, the same call `signal()` makes. Any failure is ignored: the
 * channel is closing anyway.
 */
export function sendSignal(channel: ClientChannel, name: 'INT' | 'KILL'): void {
  try {
    channel.signal(name);
    const internal = channel as unknown as { outgoing?: { id: number; state: string }; _client?: { _protocol?: { signal(id: number, name: string): void } } };
    if (internal.outgoing && internal.outgoing.state !== 'open' && internal.outgoing.state !== 'closing') {
      internal._client?._protocol?.signal(internal.outgoing.id, name);
    }
  } catch {
    // the channel is closing
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The text written to stdin. Exposed for tests. */
export function buildStdin(request: SshExecRequest, delimiter: string): string {
  const interpreter = request.interpreter ?? 'bash';
  const variables = { ...(request.env ?? {}), ...(request.secrets ?? {}) };
  for (const name of Object.keys(variables)) {
    if (!ENV_NAME.test(name)) throw new Error('Invalid environment variable name');
  }

  if (interpreter === 'python3') {
    // JSON string literals are valid Python string literals for the characters a value can carry.
    const lines = ['import os as _sk_os, sys as _sk_sys'];
    for (const [name, value] of Object.entries(variables)) lines.push(`_sk_os.environ[${JSON.stringify(name)}] = ${JSON.stringify(value)}`);
    if (request.args && request.args.length > 0) lines.push(`_sk_sys.argv[1:] = [${request.args.map((a) => JSON.stringify(a)).join(', ')}]`);
    if (request.workdir) lines.push(`_sk_os.chdir(${JSON.stringify(request.workdir)})`);
    lines.push(request.script);
    return `${lines.join('\n')}\n`;
  }

  const lines: string[] = [];
  if (request.strict && interpreter === 'bash') lines.push('set -euo pipefail');
  for (const [name, value] of Object.entries(variables)) lines.push(`export ${name}=${shellQuote(value)}`);
  if (request.workdir) lines.push(`cd -- ${shellQuote(request.workdir)}`);
  if (request.args && request.args.length > 0) lines.push(`set -- ${request.args.map(shellQuote).join(' ')}`);
  // The body is parsed as a heredoc, then evaluated: it can read stdin without eating its own text.
  lines.push(`eval "$(cat <<'${delimiter}'`, request.script, delimiter, ')"');
  return `${lines.join('\n')}\n`;
}

function newDelimiter(script: string): string {
  let delimiter = `SK_EOF_${createHash('sha256').update(String(Math.random()) + String(process.hrtime.bigint())).digest('hex').slice(0, 16)}`;
  while (script.includes(delimiter)) delimiter += 'X';
  return delimiter;
}

@Injectable()
export class SshExecutor {
  async exec(client: Client, request: SshExecRequest): Promise<SshExecResult> {
    const commandSha256 = sha256Hex(request.script);
    return tracer.startActiveSpan(
      'ssh.exec',
      {
        attributes: {
          ...(request.span
            ? {
                'runbook.step.kind': request.span.stepKind,
                'runbook.step.index': request.span.stepIndex,
                'server.profile.id': request.span.serverProfileId,
              }
            : {}),
          'command.sha256': commandSha256,
        },
      },
      async (span) => {
        try {
          const result = await this.run(client, request, commandSha256);
          span.setAttribute('exit.code', result.exitCode ?? -1);
          span.setStatus({ code: result.exitCode === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR });
          return result;
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private run(client: Client, request: SshExecRequest, commandSha256: string): Promise<SshExecResult> {
    const stdin = buildStdin(request, newDelimiter(request.script));
    const line = execCommandLine(request);

    return new Promise<SshExecResult>((resolve, reject) => {
      client.exec(line, { pty: false }, (error, channel: ClientChannel) => {
        if (error) return reject(error);

        let bytes = 0;
        let truncated = false;
        let timedOut = false;
        let aborted = false;
        let sudoPasswordRequired = false;
        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let stderrTail = '';
        let settled = false;
        let killTimer: NodeJS.Timeout | undefined;
        let closeTimer: NodeJS.Timeout | undefined;
        const maxBytes = request.maxBytes ?? Number.POSITIVE_INFINITY;

        const clear = (): void => {
          clearTimeout(timeout);
          if (killTimer) clearTimeout(killTimer);
          if (closeTimer) clearTimeout(closeTimer);
          request.signal?.removeEventListener('abort', onAbort);
        };
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clear();
          resolve({
            exitCode,
            signal: exitSignal,
            timedOut,
            aborted,
            bytes,
            truncated,
            sudoPasswordRequired,
            commandSha256,
          });
        };

        const interrupt = (): void => {
          if (settled) return;
          sendSignal(channel, 'INT');
          killTimer = setTimeout(() => {
            if (settled) return;
            sendSignal(channel, 'KILL');
            closeTimer = setTimeout(() => {
              try {
                channel.close();
              } catch {
                // already closed
              }
              // A server that never reports the close must not hold the step forever.
              setTimeout(finish, FORCE_CLOSE_GRACE_MS).unref();
            }, FORCE_CLOSE_GRACE_MS);
          }, KILL_GRACE_MS);
        };

        const timeout = setTimeout(() => {
          timedOut = true;
          interrupt();
        }, request.timeoutSec * 1000);

        const onAbort = (): void => {
          aborted = true;
          interrupt();
        };
        if (request.signal) {
          if (request.signal.aborted) onAbort();
          else request.signal.addEventListener('abort', onAbort, { once: true });
        }

        const deliver = (stream: 'stdout' | 'stderr', data: Buffer): void => {
          bytes += data.length;
          if (bytes > maxBytes) {
            truncated = true;
            return;
          }
          if (stream === 'stderr') {
            stderrTail = (stderrTail + data.toString('utf8')).slice(-512);
            if (/a password is required/i.test(stderrTail)) sudoPasswordRequired = true;
          }
          request.onChunk({ stream, data });
        };

        channel.on('data', (data: Buffer) => deliver('stdout', data));
        channel.stderr.on('data', (data: Buffer) => deliver('stderr', data));
        channel.on('exit', (code: number | null | undefined, signal: string | null | undefined) => {
          exitCode = typeof code === 'number' ? code : null;
          exitSignal = signal ?? null;
        });
        channel.on('error', () => finish());
        channel.on('close', (code?: number | null, signal?: string | null) => {
          if (exitCode === null && typeof code === 'number') exitCode = code;
          if (exitSignal === null && signal) exitSignal = signal;
          finish();
        });

        // The script, then EOF once it is flushed (`eof()`, so the channel stays open for a later `signal`).
        channel.write(stdin, () => {
          try {
            channel.eof();
          } catch {
            // the channel closed first
          }
        });
      });
    });
  }
}
