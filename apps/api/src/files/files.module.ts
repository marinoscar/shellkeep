import { Module } from '@nestjs/common';
import { AuthModule } from '@marinoscar/platform-api/identity';

import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SshModule } from '../ssh/ssh.module';
import { TerminalModule } from '../terminal/terminal.module';
import { DownloadTokenStore } from './download-token.store';
import { FilesController } from './files.controller';
import { FilesDownloadController } from './files-download.controller';
import { FilesRateLimiter } from './files-rate-limiter';
import { FilesPrincipalResolver } from './files-principal.resolver';
import { FilesService } from './files.service';
import { SftpService } from './sftp.service';

/** Files on a server over SFTP (#153): list, stat, ranged text and streamed download. */
@Module({
  imports: [AuthModule, PrismaModule, ServerProfilesModule, TerminalModule, SshModule],
  controllers: [FilesController, FilesDownloadController],
  providers: [FilesPrincipalResolver, FilesService, SftpService, DownloadTokenStore, FilesRateLimiter],
})
export class FilesModule {}
