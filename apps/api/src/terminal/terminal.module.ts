import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SshService } from './ssh.service';
import { SessionManagerService } from './session-manager.service';
import { TerminalGateway } from './terminal.gateway';
import { SessionCleanupTask } from './tasks/session-cleanup.task';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    ServerProfilesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
      }),
    }),
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SshService, SessionManagerService, TerminalGateway, SessionCleanupTask],
  exports: [SessionsService],
})
export class TerminalModule {}
