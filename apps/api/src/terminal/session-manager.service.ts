import { forwardRef, Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { SshService, SshConnection, DecryptedServerProfile } from './ssh.service';
import { SessionsService } from './sessions.service';
import { TerminalMetricsService } from './telemetry/terminal-metrics.service';
import * as WebSocket from 'ws';

interface ManagedSession {
  ssh: SshConnection;
  clients: Set<WebSocket>;
  /** Per attached socket: removes its data pipe and runs the last-client handling. */
  detachers: Map<WebSocket, () => void>;
  sessionId: string;
}

@Injectable()
export class SessionManagerService implements OnModuleInit {
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly sshService: SshService,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
    @Optional() private readonly metrics?: TerminalMetricsService,
  ) {}

  onModuleInit(): void {
    // The `app.terminal.ssh.connections` gauge: live SSH connections held by THIS process.
    this.metrics?.bindSshConnections(() => this.sessions.size);
  }

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
      detachers: new Map(),
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

    // Runs once: when the socket closes, or when the gateway detaches it (share revoked).
    const detach = () => {
      if (!managed.detachers.delete(ws)) return;
      managed.ssh.stream.removeListener('data', dataHandler);
      managed.clients.delete(ws);
      this.logger.log(`WebSocket detached from session ${sessionId}, ${managed.clients.size} remaining`);

      if (managed.clients.size === 0) {
        // All clients disconnected, mark as detached
        this.sessionsService.updateStatus(sessionId, 'detached').catch((err) => {
          this.logger.error(`Failed to update session status: ${err.message}`);
        });
      }
    };
    managed.detachers.set(ws, detach);
    ws.on('close', detach);

    return true;
  }

  /**
   * Detaches one client without closing its socket or the SSH stream. A session left with no client
   * is handled as on a normal disconnect (row `detached`, tmux keeps running). A no-op when unknown.
   */
  detachWebSocket(sessionId: string, ws: WebSocket): void {
    this.sessions.get(sessionId)?.detachers.get(ws)?.();
  }

  /** The ids of the sessions whose SSH stream this process holds. */
  liveSessionIds(): string[] {
    return [...this.sessions.keys()];
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
