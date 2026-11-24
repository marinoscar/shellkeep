import { Module } from '@nestjs/common';
import { UserCredentialsModule } from '@marinoscar/platform-api/credentials';
import { AuthModule } from '@marinoscar/platform-api/identity';
import { PrismaModule } from '../prisma/prisma.module';
import { sharingModule } from '../platform/sharing/sharing.config';
import { ServerProfilesModule } from '../server-profiles/server-profiles.module';
import { SshModule } from '../ssh/ssh.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SshService } from './ssh.service';
import { SessionHistoryService } from './session-history.service';
import { LIVE_SESSION_CLOSER } from './live-session-closer';
import { LiveSessionReconciler } from './live-session-reconciler';
import { LiveSessionResetListener } from './live-session-reset.listener';
import { SessionManagerService } from './session-manager.service';
import { TerminalGateway } from './terminal.gateway';
import { TerminalPrincipalResolver } from './ws/terminal-principal.resolver';
import { TerminalMaintenancePolicy } from './ws/terminal-maintenance.policy';
import { SessionReapHandler } from './jobs/session-reap.handler';
import { TerminalWebhooksModule } from './webhooks/terminal-webhooks.module';
import { TerminalAlertRulesSeed } from './alerts/terminal-alert-rules.seed';
import { TerminalMetricsService } from './telemetry/terminal-metrics.service';
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
    // The connection factory (host-key verification) every SSH path goes through (#60).
    SshModule,
    // The identity slice's own module: `AuthService` (its principal resolution)
    // and `JwtService` for `TerminalPrincipalResolver`. Nest modules are
    // singletons, so this is the instance `IdentityModule.forRoot()` mounts.
    AuthModule,
    // `UserCredentialsService`: the Doctor's tmux probe reads the probe profile's secrets.
    UserCredentialsModule,
    // `TerminalWebhooksService`: the session events (#54).
    TerminalWebhooksModule,
    // `AccessPolicy`: a session is created only on a server the caller may `connect` to (#71).
    sharingModule,
  ],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SshService,
    // The only reader of a tmux pane (#56).
    SessionHistoryService,
    SessionManagerService,
    { provide: LIVE_SESSION_CLOSER, useExisting: SessionManagerService },
    // Closes live streams after a reset or purge job settles (#145).
    LiveSessionReconciler,
    LiveSessionResetListener,
    // The `app.terminal.*` recorders and gauges (#53).
    TerminalMetricsService,
    TerminalPrincipalResolver,
    TerminalMaintenancePolicy,
    TerminalGateway,
    // The reaper: an enqueue-only cron and the `terminal.session.reap` job it queues (#49).
    SessionCleanupTask,
    SessionReapHandler,
    // ShellKeep's four starter alert rules, seeded disabled at start (#54).
    TerminalAlertRulesSeed,
    // The terminal's About section and Doctor checks (#46). Each check registers
    // itself with the platform's `DoctorCheckRegistry` in `onModuleInit`.
    TerminalAboutSource,
    SshClientDoctorCheck,
    TerminalSshEgressContributor,
    TmuxProbeDoctorCheck,
    SessionsReaperDoctorCheck,
    LegacySecretsDoctorCheck,
  ],
  exports: [SessionsService, SessionHistoryService],
})
export class TerminalModule {}
