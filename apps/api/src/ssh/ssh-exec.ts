// =============================================================================
// One command over an open SSH client (issue #60)
// =============================================================================
//
// Runs a command on an already verified connection and collects its output and
// exit status. Never opens a connection (`ssh-connection.factory.ts` does that).
// =============================================================================

import type { Client } from 'ssh2';

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** The remote exit status, or null when the command ended on a signal. */
  exitCode: number | null;
  /** The signal that ended the command, or null. */
  signal: string | null;
}

export interface ExecOptions {
  /** Stop collecting each stream after this many bytes (the rest is drained and dropped). */
  maxBytes?: number;
}

/** Runs `command` on `client`. Rejects when the channel cannot be opened. */
export function execOnClient(client: Client, command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const limit = options.maxBytes ?? Number.POSITIVE_INFINITY;
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      stream.on('data', (chunk: Buffer) => {
        if (outBytes < limit) {
          out.push(chunk);
          outBytes += chunk.length;
        }
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        if (errBytes < limit) {
          err.push(chunk);
          errBytes += chunk.length;
        }
      });
      stream.on('error', reject);
      stream.on('close', (code: number | null | undefined, signal: string | null | undefined) => {
        const clip = (parts: Buffer[]) => {
          const all = Buffer.concat(parts);
          return (Number.isFinite(limit) && all.length > limit ? all.subarray(0, limit) : all).toString('utf8');
        };
        resolve({
          stdout: clip(out),
          stderr: clip(err),
          exitCode: typeof code === 'number' ? code : null,
          signal: signal ?? null,
        });
      });
    });
  });
}
