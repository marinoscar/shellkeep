import { Module } from '@nestjs/common';
import { UserCredentialsModule } from '@marinoscar/platform-api/credentials';
import { PrismaModule } from '../prisma/prisma.module';
import { sharingModule } from '../platform/sharing/sharing.config';
import { TerminalWebhooksModule } from '../terminal/webhooks/terminal-webhooks.module';
import { SshModule } from '../ssh/ssh.module';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';

@Module({
  imports: [PrismaModule, UserCredentialsModule, SshModule, TerminalWebhooksModule, sharingModule],
  controllers: [ServerProfilesController],
  providers: [ServerProfilesService],
  exports: [ServerProfilesService],
})
export class ServerProfilesModule {}
