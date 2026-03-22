import { Injectable, Logger } from '@nestjs/common';
import { SshService, SshConnection, DecryptedServerProfile } from './ssh.service';
import { SessionsService } from './sessions.service';
import * as WebSocket from 'ws';

interface ManagedSession {
  ssh: SshConnection;
  clients: Set<WebSocket>;
  sessionId: string;
}

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly sshService: SshService,
    private readonly sessionsService: SessionsService,
  ) {}

  async startSession(
    sessionId: string,
    profile: DecryptedServerProfile,
    tmuxSessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    // Check if session is already running
    if (this.sessions.has(sessionId)) {
      return;
    }

    const ssh = await this.sshService.connect(profile, tmuxSessionId, cols, rows);

    const managed: ManagedSession = {
      ssh,
      clients: new Set(),
      sessionId,
    };

    // Handle SSH stream close
    ssh.stream.on('close', () => {
      this.logger.log(`SSH stream closed for session ${sessionId}`);
      this.handleStreamClose(sessionId);
    });

    ssh.stream.on('error', (err: Error) => {
      this.logger.error(`SSH stream error for session ${sessionId}: ${err.message}`);
      this.handleStreamClose(sessionId);
    });

    this.sessions.set(sessionId, managed);
    this.logger.log(`Session ${sessionId} started`);
  }

  attachWebSocket(sessionId: string, ws: WebSocket): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return false;
    }

    managed.clients.add(ws);

    // Pipe SSH output to this WebSocket
    const dataHandler = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    managed.ssh.stream.on('data', dataHandler);

    // Clean up when WebSocket closes
    ws.on('close', () => {
      managed.ssh.stream.removeListener('data', dataHandler);
      managed.clients.delete(ws);
      this.logger.log(`WebSocket detached from session ${sessionId}, ${managed.clients.size} remaining`);

      if (managed.clients.size === 0) {
        // All clients disconnected, mark as detached
        this.sessionsService.updateStatus(sessionId, 'detached').catch((err) => {
          this.logger.error(`Failed to update session status: ${err.message}`);
        });
      }
    });

    return true;
  }

  sendInput(sessionId: string, data: Buffer): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      managed.ssh.stream.write(data);
      // Throttled activity update
      this.sessionsService.updateActivity(sessionId).catch(() => {});
    }
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      managed.ssh.resize(cols, rows);
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      // Notify all clients
      for (const ws of managed.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'session_ended', reason: 'terminated' }));
        }
      }
      managed.ssh.close();
      this.sessions.delete(sessionId);
      this.logger.log(`Session ${sessionId} terminated`);
    }
  }

  isSessionRunning(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private handleStreamClose(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    // Notify all connected WebSocket clients
    for (const ws of managed.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'session_ended', reason: 'stream_closed' }));
      }
    }

    this.sessions.delete(sessionId);

    // Update DB status
    this.sessionsService.updateStatus(sessionId, 'terminated').catch((err) => {
      this.logger.error(`Failed to update session status: ${err.message}`);
    });
  }
}
