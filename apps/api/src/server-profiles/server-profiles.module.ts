import { Module } from '@nestjs/common';
import { UserCredentialsModule } from '@marinoscar/platform-api/credentials';
import { PrismaModule } from '../prisma/prisma.module';
import { TerminalWebhooksModule } from '../terminal/webhooks/terminal-webhooks.module';
import { SshModule } from '../ssh/ssh.module';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';

@Module({
  imports: [PrismaModule, UserCredentialsModule, SshModule, TerminalWebhooksModule],
  controllers: [ServerProfilesController],
  providers: [ServerProfilesService],
  exports: [ServerProfilesService],
})
export class ServerProfilesModule {}
