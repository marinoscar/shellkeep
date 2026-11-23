import {
  DEFAULT_TERMINAL_SYSTEM_SETTINGS,
  TERMINAL_SYSTEM_BOUNDS,
  TERMINAL_SYSTEM_SETTINGS,
  terminalSystemSettingsPatchSchema,
  terminalSystemSettingsSchema,
} from './terminal.system-settings';

const PROFILE_ID = '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b';

describe('terminal system settings', () => {
  it('defaults to the thresholds the session reaper has always used (1 h, 12 h, 3 days)', () => {
    expect(DEFAULT_TERMINAL_SYSTEM_SETTINGS).toEqual({
      detachAfterMinutes: 60,
      terminateDetachedAfterHours: 12,
      purgeTerminatedAfterDays: 3,
      doctorProbeProfileId: null,
    });
    expect(() => terminalSystemSettingsSchema.parse(DEFAULT_TERMINAL_SYSTEM_SETTINGS)).not.toThrow();
  });

  describe.each(Object.entries(TERMINAL_SYSTEM_BOUNDS))('%s bounds', (field, { min, max }) => {
    it.each([min, max])('accepts %d', (value) => {
      expect(() =>
        terminalSystemSettingsPatchSchema.parse({ [field]: value }),
      ).not.toThrow();
    });

    it.each([min - 1, max + 1, 1.5, '60'])('rejects %p', (value) => {
      expect(() => terminalSystemSettingsPatchSchema.parse({ [field]: value })).toThrow();
    });
  });

  it('accepts a uuid or null as the Doctor probe profile and rejects anything else', () => {
    expect(terminalSystemSettingsPatchSchema.parse({ doctorProbeProfileId: PROFILE_ID })).toEqual({
      doctorProbeProfileId: PROFILE_ID,
    });
    expect(terminalSystemSettingsPatchSchema.parse({ doctorProbeProfileId: null })).toEqual({
      doctorProbeProfileId: null,
    });
    expect(() => terminalSystemSettingsPatchSchema.parse({ doctorProbeProfileId: 'srv-1' })).toThrow();
    expect(() => terminalSystemSettingsPatchSchema.parse({ doctorProbeProfileId: 7 })).toThrow();
  });

  describe('merge', () => {
    const current = { ...DEFAULT_TERMINAL_SYSTEM_SETTINGS, doctorProbeProfileId: PROFILE_ID };

    it('keeps every field a patch does not name', () => {
      expect(TERMINAL_SYSTEM_SETTINGS.merge(current, { detachAfterMinutes: 30 })).toEqual({
        ...current,
        detachAfterMinutes: 30,
      });
      expect(TERMINAL_SYSTEM_SETTINGS.merge(current, undefined)).toEqual(current);
    });

    it('clears the probe profile on null and keeps it on undefined', () => {
      expect(TERMINAL_SYSTEM_SETTINGS.merge(current, { doctorProbeProfileId: null }).doctorProbeProfileId).toBeNull();
      expect(TERMINAL_SYSTEM_SETTINGS.merge(current, {}).doctorProbeProfileId).toBe(PROFILE_ID);
    });
  });
});
