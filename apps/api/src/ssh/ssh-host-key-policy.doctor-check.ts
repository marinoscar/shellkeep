// =============================================================================
// `ssh.host_key_policy` (issue #60)
// =============================================================================
//
// Reports the host-key trust policy and how many server profiles still trust no
// key. READ-ONLY: one `count`. `tofu_auto` is a warning (it trusts whatever the
// first contact presents); the other policies pass.
// =============================================================================

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '@marinoscar/platform-api/doctor';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../prisma/prisma.service';

export const SSH_HOST_KEY_POLICY_CHECK_ID = 'ssh.host_key_policy';

@Injectable()
export class SshHostKeyPolicyDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = SSH_HOST_KEY_POLICY_CHECK_ID;
  readonly category = 'terminal';
  readonly label = 'SSH host-key policy';
  readonly settingsPath = '/servers';
  readonly timeoutMs = 5_000;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const { hostKeyPolicy } = await this.settings.getNamespace('ssh');
    const untrusted = await this.prisma.serverProfile.count({ where: { fingerprint: null } });
    const data = { policy: hostKeyPolicy, untrusted_profiles: untrusted };

    if (hostKeyPolicy === 'tofu_auto') {
      return {
        status: 'warn',
        detail: `Host keys are trusted automatically on first contact (tofu_auto); ${untrusted} profile(s) trust no key yet`,
        remedy:
          'Set `ssh.hostKeyPolicy` to `tofu_prompt` in the SSH system settings so a user verifies each new fingerprint; a changed key is refused either way.',
        data,
      };
    }
    return {
      status: 'pass',
      detail: `Host-key policy ${hostKeyPolicy}; ${untrusted} profile(s) trust no key yet`,
      data,
    };
  }
}
