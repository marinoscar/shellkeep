import {
  DEFAULT_FILES_SYSTEM_SETTINGS,
  FILES_SYSTEM_BOUNDS,
  FILES_SYSTEM_SETTINGS,
  filesSystemSettingsPatchSchema,
  filesSystemSettingsSchema,
} from './files.system-settings';

describe('files system settings', () => {
  it('defaults to the epic guardrails: 2 MB full view, 200 MB paged, 2 GB download, 100 MB upload', () => {
    expect(DEFAULT_FILES_SYSTEM_SETTINGS).toMatchObject({
      fullViewMaxBytes: 2 * 1024 * 1024,
      pagedViewMaxBytes: 200 * 1024 * 1024,
      downloadMaxBytes: 2 * 1024 * 1024 * 1024,
      uploadMaxBytes: 100 * 1024 * 1024,
    });
    expect(() => filesSystemSettingsSchema.parse(DEFAULT_FILES_SYSTEM_SETTINGS)).not.toThrow();
  });

  describe.each(Object.entries(FILES_SYSTEM_BOUNDS))('%s bounds', (field, { min, max }) => {
    it.each([min, max])('accepts %d', (value) => {
      expect(() => filesSystemSettingsPatchSchema.parse({ [field]: value })).not.toThrow();
    });
    it.each([min - 1, max + 1, 1.5, '10'])('rejects %p', (value) => {
      expect(() => filesSystemSettingsPatchSchema.parse({ [field]: value })).toThrow();
    });
  });

  it('merge keeps every field a patch does not name', () => {
    expect(FILES_SYSTEM_SETTINGS.merge(DEFAULT_FILES_SYSTEM_SETTINGS, { downloadsPerMinute: 5 })).toEqual({
      ...DEFAULT_FILES_SYSTEM_SETTINGS,
      downloadsPerMinute: 5,
    });
  });
});
