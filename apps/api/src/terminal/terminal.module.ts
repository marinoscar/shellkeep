import { Module } from '@nestjs/common';
import { AuthModule } from '@marinoscar/platform-api/identity';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SshService } from './ssh.service';
import { SessionManagerService } from './session-manager.service';
import { TerminalGateway } from './terminal.gateway';
import { TerminalPrincipalResolver } from './ws/terminal-principal.resolver';
import { TerminalMaintenancePolicy } from './ws/terminal-maintenance.policy';
import { SessionCleanupTask } from './tasks/session-cleanup.task';

@Module({
  imports: [
    PrismaModule,
    ServerProfilesModule,
    // The identity slice's own module: `AuthService` (its principal resolution)
    // and `JwtService` for `TerminalPrincipalResolver`. Nest modules are
    // singletons, so this is the instance `IdentityModule.forRoot()` mounts.
    AuthModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SshService,
    SessionManagerService,
    TerminalPrincipalResolver,
    TerminalMaintenancePolicy,
    TerminalGateway,
    SessionCleanupTask,
  ],
  exports: [SessionsService],
})
export class TerminalModule {}
