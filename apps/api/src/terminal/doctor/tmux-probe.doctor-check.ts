// =============================================================================
// `terminal.tmux.probe` (issue #46)
// =============================================================================
//
// Proves a real SSH target is reachable AND has tmux, with the host key pinned:
//
//   - `terminal.doctorProbeProfileId` unset                      -> skip
//   - the profile no longer exists                               -> warn
//   - the profile has no pinned host key (`fingerprint` null)    -> warn (full
//     verification and trust-on-first-use land in #60; nothing is sent to a host
//     whose key nobody has pinned)
//   - otherwise connect with the profile's credentials, verify the presented key
//     against `fingerprint` BEFORE authenticating, run exactly
//     `command -v tmux && tmux -V`, disconnect:
//       tmux found                                               -> pass (the version)
//       tmux missing, key mismatch, auth or network failure      -> fail
//
// READ-ONLY, here and on the remote: no audit row, no session row, no write to
// the profile (not even a `last used`), one fixed command. The profile's
// credentials are read server-side with `UserCredentialsService.getSecret` and
// live only inside the SSH call; no result, log line or error carries them or any
// remote output beyond the `tmux <version>` token. 10 s end to end.
// =============================================================================

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

import { PrismaService } from '../../prisma/prisma.service';
import { SSH_CREDENTIAL_PURPOSE, sshCredentialName, type SshSecretField } from '../../server-profiles/ssh-credentials';
import { TMUX_PROBE_TIMEOUT_MS, probeTmux } from './tmux-probe';

export const TMUX_PROBE_CHECK_ID = 'terminal.tmux.probe';

const PROBE_REMEDY =
  'Set `doctorProbeProfileId` in the terminal system settings to a server profile with a pinned host key ' +
  'that has tmux installed, or install tmux on the server (e.g. `apt install tmux`).';

@Injectable()
export class TmuxProbeDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = TMUX_PROBE_CHECK_ID;
  readonly category = 'terminal';
  readonly label = 'tmux on the probe server';
  readonly settingsPath = '/servers';
  // The exchange is bounded at 10 s; the guard waits a little longer so the
  // probe's own timeout, not the guard's, is what a slow host reports.
  readonly timeoutMs = TMUX_PROBE_TIMEOUT_MS + 2_000;

  private readonly logger = new Logger(TmuxProbeDoctorCheck.name);

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly credentials: UserCredentialsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const { doctorProbeProfileId } = await this.settings.getNamespace('terminal');
    if (!doctorProbeProfileId) {
      return {
        status: 'skip',
        detail: 'No probe server is configured (terminal.doctorProbeProfileId is unset)',
      };
    }

    const profile = await this.prisma.serverProfile.findUnique({
      where: { id: doctorProbeProfileId },
      select: {
        id: true,
        userId: true,
        hostname: true,
        port: true,
        username: true,
        authMethod: true,
        fingerprint: true,
      },
    });
    if (!profile) {
      return {
        status: 'warn',
        detail: 'The configured probe server profile no longer exists',
        remedy: PROBE_REMEDY,
      };
    }

    if (!profile.fingerprint) {
      return {
        status: 'warn',
        detail: 'The probe server has no pinned host key, so it is not contacted',
        remedy:
          'Pin the host key of the probe server profile (host-key trust arrives with the host-key verification work); ' +
          'until then the probe never connects to an unverified host.',
      };
    }

    const secret = (field: SshSecretField) =>
      this.credentials.getSecret(profile.userId, SSH_CREDENTIAL_PURPOSE, sshCredentialName(profile.id, field));
    const [password, privateKey, passphrase] = await Promise.all([
      secret('password'),
      secret('private_key'),
      secret('passphrase'),
    ]);

    const result = await probeTmux({
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      password,
      privateKey,
      passphrase,
      fingerprint: profile.fingerprint,
    });

    switch (result.kind) {
      case 'ok':
        return {
          status: 'pass',
          detail: `${result.version} on the probe server`,
          data: { tmux_version: result.version },
        };
      case 'tmux-missing':
        return {
          status: 'fail',
          detail: 'tmux is not installed on the probe server',
          remedy: 'Install tmux on the probe server (e.g. `apt install tmux`); terminal sessions need it.',
        };
      case 'host-key-mismatch':
        return {
          status: 'fail',
          detail: `The probe server presented a different host key (${result.presented}) than the pinned one; no credential was sent`,
          remedy:
            'If the server was rebuilt, re-pin its host key on the server profile; otherwise treat this as a possible interception and investigate.',
        };
      case 'error':
        this.logger.warn(`tmux probe failed: ${result.message}`);
        return {
          status: 'fail',
          detail: 'The probe server could not be reached or refused the login',
          error: result.message,
          remedy: PROBE_REMEDY,
        };
    }
  }
}
