import { Module } from '@nestjs/common';
import { UserCredentialsModule } from '@marinoscar/platform-api/credentials';
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
import { TerminalAboutSource } from './about/terminal.about-contributor';
import { SshClientDoctorCheck } from './doctor/ssh-client.doctor-check';
import { TerminalSshEgressContributor } from './doctor/ssh-egress.contributor';
import { TmuxProbeDoctorCheck } from './doctor/tmux-probe.doctor-check';
import { SessionsReaperDoctorCheck } from './doctor/sessions-reaper.doctor-check';
import { LegacySecretsDoctorCheck } from './doctor/legacy-secrets.doctor-check';

@Module({
  imports: [
    PrismaModule,
    ServerProfilesModule,
    // The identity slice's own module: `AuthService` (its principal resolution)
    // and `JwtService` for `TerminalPrincipalResolver`. Nest modules are
    // singletons, so this is the instance `IdentityModule.forRoot()` mounts.
    AuthModule,
    // `UserCredentialsService`: the Doctor's tmux probe reads the probe profile's secrets.
    UserCredentialsModule,
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
    // The terminal's About section and Doctor checks (#46). Each check registers
    // itself with the platform's `DoctorCheckRegistry` in `onModuleInit`.
    TerminalAboutSource,
    SshClientDoctorCheck,
    TerminalSshEgressContributor,
    TmuxProbeDoctorCheck,
    SessionsReaperDoctorCheck,
    LegacySecretsDoctorCheck,
  ],
  exports: [SessionsService],
})
export class TerminalModule {}
