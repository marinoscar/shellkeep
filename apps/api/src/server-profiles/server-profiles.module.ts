import { Module } from '@nestjs/common';
import { UserCredentialsModule } from '@marinoscar/platform-api/credentials';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';

@Module({
  imports: [PrismaModule, UserCredentialsModule],
  controllers: [ServerProfilesController],
  providers: [ServerProfilesService],
  exports: [ServerProfilesService],
})
export class ServerProfilesModule {}
