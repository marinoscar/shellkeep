import {
  DEFAULT_RUNBOOKS_SYSTEM_SETTINGS,
  RUNBOOKS_SYSTEM_SETTINGS,
  orgRunbooksSettingsSchema,
  runbooksSystemSettingsPatchSchema,
  runbooksSystemSettingsSchema,
  tightenRunbooksSettings,
} from './runbooks.system-settings';

const helpers = {} as never;

describe('runbooks system settings', () => {
  it('has the defaults of the epic and they satisfy the stored schema', () => {
    expect(DEFAULT_RUNBOOKS_SYSTEM_SETTINGS).toMatchObject({
      maxTargetsPerRun: 200,
      maxConcurrency: 20,
      defaultStepTimeoutSec: 600,
      maxLogBytesPerStep: 5 * 1024 * 1024,
      approvals: { allowSelfApproval: false, defaultExpirySec: 86_400 },
      ai: { agentEnabled: true },
    });
    expect(runbooksSystemSettingsSchema.safeParse(DEFAULT_RUNBOOKS_SYSTEM_SETTINGS).success).toBe(true);
  });

  it('reads a damaged stored value field by field', () => {
    const read = RUNBOOKS_SYSTEM_SETTINGS.read!;
    expect(read(undefined, helpers)).toEqual(DEFAULT_RUNBOOKS_SYSTEM_SETTINGS);
    expect(read({ maxConcurrency: 5, maxTargetsPerRun: -3, approvals: { allowSelfApproval: true }, ai: 'x' }, helpers)).toEqual({
      ...DEFAULT_RUNBOOKS_SYSTEM_SETTINGS,
      maxConcurrency: 5,
      approvals: { allowSelfApproval: true, defaultExpirySec: 86_400 },
    });
  });

  it('merges a PATCH into nested objects without dropping siblings', () => {
    const merged = RUNBOOKS_SYSTEM_SETTINGS.merge(DEFAULT_RUNBOOKS_SYSTEM_SETTINGS, { approvals: { allowSelfApproval: true }, maxConcurrency: 8 });
    expect(merged.approvals).toEqual({ allowSelfApproval: true, defaultExpirySec: 86_400 });
    expect(merged.maxConcurrency).toBe(8);
    expect(merged.ai).toEqual({ agentEnabled: true });
  });

  it('rejects out-of-range values', () => {
    expect(runbooksSystemSettingsPatchSchema.safeParse({ maxConcurrency: 0 }).success).toBe(false);
    expect(runbooksSystemSettingsPatchSchema.safeParse({ approvals: { defaultExpirySec: 5 } }).success).toBe(false);
  });

  describe('the org layer only tightens', () => {
    const system = { ...DEFAULT_RUNBOOKS_SYSTEM_SETTINGS, approvals: { allowSelfApproval: true, defaultExpirySec: 3600 } };

    it('lowers limits and switches capabilities off', () => {
      const effective = tightenRunbooksSettings(system, {
        maxTargetsPerRun: 50,
        enabled: true,
        approvals: { allowSelfApproval: false, defaultExpirySec: 600 },
        ai: { agentEnabled: false },
      });
      expect(effective).toMatchObject({
        maxTargetsPerRun: 50,
        enabled: true,
        approvals: { allowSelfApproval: false, defaultExpirySec: 600 },
        ai: { agentEnabled: false },
      });
    });

    it('never raises a limit or switches a capability on', () => {
      const restricted = { ...system, enabled: false, ai: { agentEnabled: false }, approvals: { allowSelfApproval: false, defaultExpirySec: 3600 } };
      const effective = tightenRunbooksSettings(restricted, {
        enabled: true,
        maxTargetsPerRun: 1000,
        maxConcurrency: 50,
        ai: { agentEnabled: true },
        approvals: { allowSelfApproval: true, defaultExpirySec: 86_400 },
      });
      expect(effective).toEqual(restricted);
    });

    it('is declared with the org-settings permissions and every field optional', () => {
      expect(RUNBOOKS_SYSTEM_SETTINGS.org).toMatchObject({ readPermission: 'org_settings:read', writePermission: 'org_settings:write', mode: 'tighten' });
      expect(orgRunbooksSettingsSchema.safeParse({}).success).toBe(true);
    });
  });
});
