import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientChannel } from 'ssh2';

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
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);

  async connect(
    profile: DecryptedServerProfile,
    tmuxSessionId: string,
    cols: number,
    rows: number,
  ): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      const connectConfig: any = {
        host: profile.hostname,
        port: profile.port,
        username: profile.username,
        readyTimeout: 10000,
      };

      // Configure auth based on method
      if (profile.authMethod === 'password' && profile.password) {
        connectConfig.password = profile.password;
      } else if (profile.authMethod === 'key' && profile.privateKey) {
        connectConfig.privateKey = profile.privateKey;
        if (profile.passphrase) {
          connectConfig.passphrase = profile.passphrase;
        }
      }
      // For 'agent' auth, ssh2 uses SSH_AUTH_SOCK by default

      client.on('ready', () => {
        this.logger.log(`SSH connected to ${profile.hostname}:${profile.port}`);

        // Execute tmux with -A flag (attach if exists, create if not)
        const tmuxCmd = `tmux new-session -As ${tmuxSessionId}`;

        client.exec(tmuxCmd, { pty: { cols, rows, term: 'xterm-256color' } }, (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }

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
}
