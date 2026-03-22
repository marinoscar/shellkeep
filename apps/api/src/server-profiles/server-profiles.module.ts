import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { ServerProfilesController } from './server-profiles.controller';
import { ServerProfilesService } from './server-profiles.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [ServerProfilesController],
  providers: [ServerProfilesService],
  exports: [ServerProfilesService],
})
export class ServerProfilesModule {}
