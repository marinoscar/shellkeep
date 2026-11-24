// =============================================================================
// The server facts probe (issue #60)
// =============================================================================
//
// `probe(profile)` runs ONE fixed read-only command over the connection factory
// (so the host key is verified first) and stores the parsed facts on the profile.
// `probeClient` runs it over a connection the caller already opened and verified
// (the connection test), so a test costs one handshake.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import type { Client } from 'ssh2';

import { PrismaService } from '../prisma/prisma.service';
import { SshConnectionFactory } from './ssh-connection.factory';
import { execOnClient } from './ssh-exec';
import type { DecryptedServerProfile } from './ssh-profile';
import { SERVER_FACTS_COMMAND, parseServerFacts, serverFactsSchema, type ServerFacts } from './server-facts';

/** The probe's output is a few hundred bytes; never keep more than this. */
const FACTS_MAX_BYTES = 64 * 1024;
const FACTS_TIMEOUT_MS = 15_000;

@Injectable()
export class ServerFactsService {
  private readonly logger = new Logger(ServerFactsService.name);

  constructor(
    private readonly factory: SshConnectionFactory,
    private readonly prisma: PrismaService,
  ) {}

  /** Connects, probes, stores. Rejects like the factory does (a `HostKeyError` before any credential). */
  async probe(profile: DecryptedServerProfile): Promise<ServerFacts> {
    const result = await this.factory.exec(profile, SERVER_FACTS_COMMAND, {
      timeoutMs: FACTS_TIMEOUT_MS,
      maxBytes: FACTS_MAX_BYTES,
    });
    return this.store(profile, result.stdout);
  }

  /** Probes over an open, verified connection and stores the facts. */
  async probeClient(client: Client, profile: DecryptedServerProfile): Promise<ServerFacts> {
    const result = await execOnClient(client, SERVER_FACTS_COMMAND, { maxBytes: FACTS_MAX_BYTES });
    return this.store(profile, result.stdout);
  }

  /** Best effort: a failing probe never fails the caller. */
  async tryProbeClient(client: Client, profile: DecryptedServerProfile): Promise<ServerFacts | null> {
    try {
      return await this.probeClient(client, profile);
    } catch (error) {
      this.logger.warn(`Facts probe failed for profile ${profile.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async store(profile: DecryptedServerProfile, stdout: string): Promise<ServerFacts> {
    const facts = parseServerFacts(stdout);
    await this.prisma.serverProfile.updateMany({
      where: { id: profile.id, userId: profile.userId, orgId: profile.orgId },
      data: { facts: facts as unknown as object, factsProbedAt: new Date() },
    });
    return facts;
  }
}

/** A stored `facts` value, or null when it is absent or no longer matches the schema. */
export function readStoredFacts(value: unknown): ServerFacts | null {
  const parsed = serverFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
