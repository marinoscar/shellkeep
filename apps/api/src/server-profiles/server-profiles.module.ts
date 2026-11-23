import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServerProfilesController],
  providers: [ServerProfilesService],
  exports: [ServerProfilesService],
})
export class ServerProfilesModule {}
