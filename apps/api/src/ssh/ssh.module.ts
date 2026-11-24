import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ServerFactsService } from './server-facts.service';
import { SshConnectionFactory } from './ssh-connection.factory';
import { SshHostKeyPolicyDoctorCheck } from './ssh-host-key-policy.doctor-check';

/**
 * The one SSH connection factory (host-key verification before any credential) and the
 * server facts probe. Every connection path (terminal, test, history, probe, runbooks)
 * goes through `SshConnectionFactory`. Settings, audit and metrics ports are global.
 */
@Module({
  imports: [PrismaModule],
  providers: [SshConnectionFactory, ServerFactsService, SshHostKeyPolicyDoctorCheck],
  exports: [SshConnectionFactory, ServerFactsService],
})
export class SshModule {}
