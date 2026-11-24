import { Module } from '@nestjs/common';
import { UserCredentialsModule } from '@marinoscar/platform-api/credentials';
import { StorageModule, StorageProvidersModule } from '../platform/storage/storage.config';
import { PrismaModule } from '../prisma/prisma.module';
import { sharingModule } from '../platform/sharing/sharing.config';
import { TerminalWebhooksModule } from '../terminal/webhooks/terminal-webhooks.module';
import { SshModule } from '../ssh/ssh.module';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';
import { ServerProfilesExportBinding } from './export/server-profiles-export.binding';
import { ServersUserDataPurgeHandler } from './user-data/servers-purge.handler';
import { UserDataHostModule } from '../platform/user-data/user-data-host.module';

@Module({
  imports: [PrismaModule, StorageModule, StorageProvidersModule, UserCredentialsModule, SshModule, TerminalWebhooksModule, sharingModule, UserDataHostModule],
  controllers: [ServerProfilesController],
  // `ServerProfilesExportBinding` (#68) lets the `server-profiles` export source read the caller's groups through the slice.
  // `ServersUserDataPurgeHandler` (#69) is the delegated half of the user-data purge: profiles and their saved credentials.
  providers: [ServerProfilesService, ServerProfilesExportBinding, ServersUserDataPurgeHandler],
  exports: [ServerProfilesService],
})
export class ServerProfilesModule {}
