import { Module } from '@nestjs/common';
import { AuthModule } from '@marinoscar/platform-api/identity';

import { StorageModule, StorageProvidersModule } from '../platform/storage/storage.config';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SshModule } from '../ssh/ssh.module';
import { TerminalModule } from '../terminal/terminal.module';
import { FileArchiveHandler } from './archive/file-archive.handler';
import { ARCHIVE_OBJECT_LISTER, DriverArchiveObjectLister } from './archive/archive-object-lister';
import { FileArchivePurgeHandler } from './archive/file-archive-purge.handler';
import { FileArchivesController } from './archive/file-archives.controller';
import { FileArchivesService } from './archive/file-archives.service';
import { FileArchiveTask } from './archive/file-archive.task';
import { CommandHistoryController } from './command-history/command-history.controller';
import { CommandHistoryService } from './command-history/command-history.service';
import { DownloadTokenStore } from './download-token.store';
import { FilesController } from './files.controller';
import { FilesDownloadController } from './files-download.controller';
import { FilesRateLimiter } from './files-rate-limiter';
import { FilesPrincipalResolver } from './files-principal.resolver';
import { FilesService } from './files.service';
import { SftpService } from './sftp.service';

/** Files on a server over SFTP (#153): list, stat, ranged text and streamed download. */
@Module({
  imports: [AuthModule, PrismaModule, StorageModule, StorageProvidersModule, ServerProfilesModule, TerminalModule, SshModule],
  controllers: [FilesController, CommandHistoryController, FilesDownloadController, FileArchivesController],
  providers: [
    FilesPrincipalResolver,
    FilesService,
    CommandHistoryService,
    SftpService,
    DownloadTokenStore,
    FilesRateLimiter,
    // Folder archives (#158): the request service, the two queue handlers and the enqueue-only expiry cron.
    FileArchivesService,
    FileArchiveHandler,
    FileArchivePurgeHandler,
    { provide: ARCHIVE_OBJECT_LISTER, useClass: DriverArchiveObjectLister },
    FileArchiveTask,
  ],
})
export class FilesModule {}
