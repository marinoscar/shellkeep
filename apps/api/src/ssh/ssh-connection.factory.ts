// =============================================================================
// The one SSH connection factory (issue #60)
// =============================================================================
//
// THE ONLY PLACE THAT BUILDS A `ConnectConfig` OR CALLS `new Client()`
// (`test/ssh/ssh-boundary.spec.ts` fails on a `new Client(` anywhere else).
//
// HOST KEY FIRST. ssh2 calls `hostVerifier` during key exchange, BEFORE user
// authentication. The presented key is compared with the profile's trusted
// fingerprint and the policy table (`host-key-policy.ts`); a refusal ends the
// connection there, so no password, key or agent signature is ever sent, and a
// `HostKeyError` says why. A scan sets no credential in the config at all.
//
// Agent authentication sets `agent: SSH_AUTH_SOCK` for every purpose. Secrets live
// only inside the call: no log line, span attribute, metric label or error message
// here carries one.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { AppMetricsService } from '@marinoscar/platform-api/host';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { Client, type ConnectConfig } from 'ssh2';

import { recordAudit } from '../common/audit/record-audit';
import { PrismaService } from '../prisma/prisma.service';
import { algorithmOf, fingerprintOf, sameFingerprint } from './host-key';
import { HostKeyError, type PresentedHostKey } from './host-key.error';
import {
  DEFAULT_HOST_KEY_POLICY,
  HOST_KEY_POLICIES,
  decideHostKey,
  type HostKeyOutcome,
  type HostKeyPolicy,
  type SshPurpose,
} from './host-key-policy';
import { execOnClient, type ExecOptions, type ExecResult } from './ssh-exec';
import type { DecryptedServerProfile } from './ssh-profile';
import { SSH_HOST_KEY_CHECKS_METRIC } from './ssh.metrics';

/** The handshake and authentication must finish within this. */
export const SSH_READY_TIMEOUT_MS = 10_000;
export const DEFAULT_EXEC_TIMEOUT_MS = 15_000;

export interface SshOpenOptions {
  purpose: Exclude<SshPurpose, 'scan'>;
  /** Overrides the system `ssh.hostKeyPolicy` (the Doctor passes `strict`: it never writes). */
  hostKeyPolicy?: HostKeyPolicy;
  /** Shortens the handshake and authentication deadline (never lengthens {@link SSH_READY_TIMEOUT_MS}). */
  readyTimeoutMs?: number;
}

export interface SshExecOptions extends ExecOptions {
  timeoutMs?: number;
  hostKeyPolicy?: HostKeyPolicy;
}

/** What a scan learned, without authenticating. */
export type HostKeyScan = PresentedHostKey;

const tracer = trace.getTracer('shellkeep.ssh');

@Injectable()
export class SshConnectionFactory {
  private readonly logger = new Logger(SshConnectionFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
    private readonly settings: SystemSettingsService,
    @Optional() private readonly metrics?: AppMetricsService,
  ) {}

  /** The system `ssh.hostKeyPolicy`; the default when it cannot be read. */
  async currentPolicy(): Promise<HostKeyPolicy> {
    try {
      const { hostKeyPolicy } = await this.settings.getNamespace('ssh');
      return (HOST_KEY_POLICIES as readonly string[]).includes(hostKeyPolicy) ? hostKeyPolicy : DEFAULT_HOST_KEY_POLICY;
    } catch (error) {
      // Fail closed: an unreadable setting is the strictest prompting policy, never auto-trust.
      this.logger.warn(`ssh.hostKeyPolicy unreadable, using ${DEFAULT_HOST_KEY_POLICY}: ${errorMessage(error)}`);
      return DEFAULT_HOST_KEY_POLICY;
    }
  }

  /**
   * Opens an authenticated connection after the host key was verified. Rejects with a
   * {@link HostKeyError} when the key is unknown (and the policy does not auto-trust) or
   * changed, before any credential is sent; with the ssh2 error for anything else.
   */
  async open(profile: DecryptedServerProfile, options: SshOpenOptions): Promise<Client> {
    const policy = options.hostKeyPolicy ?? (await this.currentPolicy());
    return tracer.startActiveSpan('ssh.connect', { attributes: { 'ssh.purpose': options.purpose } }, async (span) => {
      try {
        const client = await this.connect(profile, options.purpose, policy, options.readyTimeoutMs);
        span.setStatus({ code: SpanStatusCode.OK });
        return client;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    }) as Promise<Client>;
  }

  /**
   * Reads the key the server presents and disconnects, sending NO credential (the
   * connection config carries none). Rejects with the ssh2 error when the server
   * cannot be reached.
   */
  async scan(target: Pick<DecryptedServerProfile, 'hostname' | 'port' | 'username'>): Promise<HostKeyScan> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let captured: HostKeyScan | undefined;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        try {
          client.end();
          client.destroy();
        } catch {
          // already closed
        }
        if (captured) resolve(captured);
        else reject(error ?? new Error('The connection closed before the server presented a host key'));
      };
      client.on('error', (error) => finish(error));
      client.on('close', () => finish());
      client.on('ready', () => finish());
      const config: ConnectConfig = {
        host: target.hostname,
        port: target.port,
        username: target.username,
        readyTimeout: SSH_READY_TIMEOUT_MS,
        hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
          captured = { fingerprint: fingerprintOf(key), algorithm: algorithmOf(key) };
          verify(false);
        },
      };
      try {
        client.connect(config);
      } catch (error) {
        finish(error as Error);
      }
    });
  }

  /**
   * Opens a verified connection, runs one command and closes. The deadline covers connect
   * and command together; on expiry the connection is destroyed.
   */
  async exec(profile: DecryptedServerProfile, command: string, options: SshExecOptions = {}): Promise<ExecResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const client = await this.open(profile, {
      purpose: 'exec',
      hostKeyPolicy: options.hostKeyPolicy,
      readyTimeoutMs: timeoutMs,
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      const remaining = Math.max(deadline - Date.now(), 1);
      return await Promise.race([
        execOnClient(client, command, { maxBytes: options.maxBytes }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`SSH exec command timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
            remaining,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      try {
        client.end();
        client.destroy();
      } catch {
        // already closed
      }
    }
  }

  // ---------------------------------------------------------------------------

  /** The only `ConnectConfig` builder. */
  private buildConfig(
    profile: DecryptedServerProfile,
    hostVerifier: NonNullable<ConnectConfig['hostVerifier']>,
    readyTimeoutMs: number = SSH_READY_TIMEOUT_MS,
  ): ConnectConfig {
    const config: ConnectConfig = {
      host: profile.hostname,
      port: profile.port,
      username: profile.username,
      readyTimeout: Math.min(readyTimeoutMs, SSH_READY_TIMEOUT_MS),
      hostVerifier,
    };
    if (profile.authMethod === 'password' && profile.password) {
      config.password = profile.password;
    } else if (profile.authMethod === 'key' && profile.privateKey) {
      config.privateKey = profile.privateKey;
      if (profile.passphrase) config.passphrase = profile.passphrase;
    } else if (profile.authMethod === 'agent') {
      config.agent = process.env.SSH_AUTH_SOCK;
    }
    return config;
  }

  private connect(
    profile: DecryptedServerProfile,
    purpose: SshPurpose,
    policy: HostKeyPolicy,
    readyTimeoutMs?: number,
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      let refusal: HostKeyError | undefined;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        try {
          client.end();
          client.destroy();
        } catch {
          // already closed
        }
        reject(refusal ?? error);
      };

      client.once('ready', () => {
        if (settled) return;
        settled = true;
        // A later transport error must never be an unhandled 'error' event.
        client.on('error', (error) => this.logger.warn(`SSH connection error: ${error.message}`));
        resolve(client);
      });
      client.on('error', (error) => fail(error));
      client.on('close', () => fail(new Error('The connection closed before it was ready')));

      const hostVerifier = (key: Buffer, verify: (ok: boolean) => void): void => {
        const presented: PresentedHostKey = { fingerprint: fingerprintOf(key), algorithm: algorithmOf(key) };
        void this.verifyHostKey(profile, purpose, policy, presented).then(
          (error) => {
            if (error) refusal = error;
            verify(!error);
          },
          (error) => {
            this.logger.error(`Host key verification failed for profile ${profile.id}: ${errorMessage(error)}`);
            verify(false);
          },
        );
      };

      try {
        client.connect(this.buildConfig(profile, hostVerifier, readyTimeoutMs));
      } catch (error) {
        fail(error as Error);
      }
    });
  }

  /** Applies the policy table. Returns the refusal, or undefined to accept. */
  private async verifyHostKey(
    profile: DecryptedServerProfile,
    purpose: SshPurpose,
    policy: HostKeyPolicy,
    presented: PresentedHostKey,
  ): Promise<HostKeyError | undefined> {
    const decision = decideHostKey({ trusted: profile.fingerprint, presented: presented.fingerprint, policy, purpose });
    if (decision.action === 'capture') return undefined;

    if (decision.action === 'accept') {
      this.record('match');
      return undefined;
    }

    if (decision.action === 'trust') {
      const stored = await this.autoTrust(profile, presented);
      if (stored) {
        this.record('auto_trusted');
        return undefined;
      }
      // Someone trusted a key while we connected: compare against it, never accept blindly.
      const current = await this.prisma.serverProfile.findFirst({
        where: { id: profile.id, userId: profile.userId, orgId: profile.orgId },
        select: { fingerprint: true },
      });
      if (current?.fingerprint && sameFingerprint(current.fingerprint, presented.fingerprint)) {
        this.record('match');
        return undefined;
      }
      this.record('mismatch');
      return new HostKeyError('HOST_KEY_MISMATCH', presented, current?.fingerprint ?? undefined, profile.id);
    }

    this.record(decision.outcome);
    if (decision.outcome === 'mismatch') {
      // Both fingerprints are public values; no credential is in scope here.
      this.logger.warn(
        `ssh.host_key.mismatch profile=${profile.id} expected=${profile.fingerprint} presented=${presented.fingerprint}`,
      );
    }
    return new HostKeyError(
      decision.code,
      presented,
      profile.fingerprint ?? undefined,
      profile.id,
    );
  }

  /** Stores the presented key on a profile that still trusts none. False when it lost a race. */
  private async autoTrust(profile: DecryptedServerProfile, presented: PresentedHostKey): Promise<boolean> {
    const result = await this.prisma.serverProfile.updateMany({
      where: { id: profile.id, userId: profile.userId, orgId: profile.orgId, fingerprint: null },
      data: {
        fingerprint: presented.fingerprint,
        hostKeyAlgorithm: presented.algorithm,
        hostKeyTrustedAt: new Date(),
        hostKeyTrustedBy: null,
      },
    });
    if (result.count === 0) return false;
    await recordAudit(this.auditSink, this.logger, {
      action: 'server_profile.host_key_auto_trusted',
      actorUserId: null,
      targetType: 'server_profile',
      targetId: profile.id,
      meta: { hostname: profile.hostname, fingerprint: presented.fingerprint, algorithm: presented.algorithm },
    });
    return true;
  }

  private record(outcome: HostKeyOutcome): void {
    trace.getActiveSpan()?.setAttribute('ssh.host_key.outcome', outcome);
    this.metrics?.add(SSH_HOST_KEY_CHECKS_METRIC, 1, { outcome });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
