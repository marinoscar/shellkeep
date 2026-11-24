import { Injectable, Logger } from '@nestjs/common';
import type { Client, ClientChannel } from 'ssh2';

import { SshConnectionFactory } from '../ssh/ssh-connection.factory';
import type { ExecResult } from '../ssh/ssh-exec';
import type { DecryptedServerProfile } from '../ssh/ssh-profile';

export type { DecryptedServerProfile } from '../ssh/ssh-profile';
export type { ExecResult } from '../ssh/ssh-exec';

export interface SshConnection {
  client: Client;
  stream: ClientChannel;
  close: () => void;
  resize: (cols: number, rows: number) => void;
}

/**
 * The terminal's SSH operations. Every connection is opened by the shared
 * `SshConnectionFactory`, which verifies the host key before any credential is sent:
 * a `HostKeyError` from here means nothing was authenticated.
 */
@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);

  constructor(private readonly factory: SshConnectionFactory) {}

  async connect(
    profile: DecryptedServerProfile,
    tmuxSessionId: string,
    cols: number,
    rows: number,
  ): Promise<SshConnection> {
    const client = await this.factory.open(profile, { purpose: 'interactive' });
    this.logger.log(`SSH connected to ${profile.hostname}:${profile.port}`);

    return new Promise<SshConnection>((resolve, reject) => {
      // Open an interactive shell with PTY, then run tmux inside it
      client.shell({ cols, rows, term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          client.end();
          return reject(err);
        }

        // Launch tmux inside the shell (-A flag: attach if exists, create if not)
        const tmuxCmd = `tmux new-session -As ${tmuxSessionId} \\; set-option history-limit 50000 \\; set-option mouse on\n`;
        stream.write(tmuxCmd);

        resolve({
          client,
          stream,
          close: () => {
            stream.close();
            client.end();
          },
          resize: (newCols: number, newRows: number) => {
            stream.setWindow(newRows, newCols, 0, 0);
          },
        });
      });
    });
  }

  /** Runs one command and reports how it ended; the caller decides what a non-zero exit means. */
  async execCommand(
    profile: DecryptedServerProfile,
    command: string,
    options: { timeoutMs?: number } = {},
  ): Promise<ExecResult> {
    return this.factory.exec(profile, command, { timeoutMs: options.timeoutMs });
  }

  /**
   * Runs one command and returns its stdout. A failed command (non-zero exit with output on
   * stderr) rejects with the trimmed stderr: the history download's long-standing behaviour.
   */
  async execForOutput(profile: DecryptedServerProfile, command: string): Promise<string> {
    const result = await this.execCommand(profile, command);
    if (result.exitCode !== 0 && result.stderr.length > 0) {
      throw new Error(result.stderr.trim());
    }
    return result.stdout;
  }
}
