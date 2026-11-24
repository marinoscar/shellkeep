import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SshConnectionFactory } from './ssh-connection.factory';

/**
 * The one SSH connection factory: host-key verification before any credential is sent.
 * Every connection path goes through `SshConnectionFactory`. Settings, audit and metrics
 * ports are global.
 */
@Module({
  imports: [PrismaModule],
  providers: [SshConnectionFactory],
  exports: [SshConnectionFactory],
})
export class SshModule {}
