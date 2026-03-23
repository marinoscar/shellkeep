import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';

export interface SshConnection {
  client: Client;
  stream: ClientChannel;
  close: () => void;
  resize: (cols: number, rows: number) => void;
}

export interface DecryptedServerProfile {
  hostname: string;
  port: number;
  username: string;
  authMethod: string;
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
}

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);

  private buildConnectConfig(profile: DecryptedServerProfile): ConnectConfig {
    const config: ConnectConfig = {
      host: profile.hostname,
      port: profile.port,
      username: profile.username,
      readyTimeout: 10000,
    };

    if (profile.authMethod === 'password' && profile.password) {
      config.password = profile.password;
    } else if (profile.authMethod === 'key' && profile.privateKey) {
      config.privateKey = profile.privateKey;
      if (profile.passphrase) {
        config.passphrase = profile.passphrase;
      }
    }
    // For 'agent' auth, ssh2 uses SSH_AUTH_SOCK by default

    return config;
  }

  async connect(
    profile: DecryptedServerProfile,
    tmuxSessionId: string,
    cols: number,
    rows: number,
  ): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const connectConfig = this.buildConnectConfig(profile);

      client.on('ready', () => {
        this.logger.log(`SSH connected to ${profile.hostname}:${profile.port}`);

        // Open an interactive shell with PTY, then run tmux inside it
        client.shell({ cols, rows, term: 'xterm-256color' }, (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }

          // Launch tmux inside the shell (-A flag: attach if exists, create if not)
          const tmuxCmd = `tmux new-session -As ${tmuxSessionId} \\; set-option history-limit 50000\n`;
          stream.write(tmuxCmd);

          const connection: SshConnection = {
            client,
            stream,
            close: () => {
              stream.close();
              client.end();
            },
            resize: (newCols: number, newRows: number) => {
              stream.setWindow(newRows, newCols, 0, 0);
            },
          };

          resolve(connection);
        });
      });

      client.on('error', (err) => {
        this.logger.error(`SSH connection error: ${err.message}`);
        reject(err);
      });

      client.connect(connectConfig);
    });
  }

  async execCommand(profile: DecryptedServerProfile, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const connectConfig = this.buildConnectConfig(profile);
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          client.end();
          reject(new Error('SSH exec command timed out after 15 seconds'));
        }
      }, 15000);

      const finish = (err?: Error, result?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client.end();
        if (err) {
          reject(err);
        } else {
          resolve(result ?? '');
        }
      };

      client.on('ready', () => {
        this.logger.log(`SSH exec connected to ${profile.hostname}:${profile.port}`);

        client.exec(command, (err, stream) => {
          if (err) {
            return finish(err);
          }

          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];

          stream.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
          });

          stream.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
          });

          stream.on('close', (code: number) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');

            if (code !== 0 && stderr.length > 0) {
              return finish(new Error(stderr.trim()));
            }

            finish(undefined, stdout);
          });
        });
      });

      client.on('error', (err) => {
        this.logger.error(`SSH exec connection error: ${err.message}`);
        finish(err);
      });

      client.connect(connectConfig);
    });
  }
}
