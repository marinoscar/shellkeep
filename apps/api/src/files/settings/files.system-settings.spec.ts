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

  describe('size ordering: fullViewMaxBytes <= pagedViewMaxBytes <= downloadMaxBytes', () => {
    const MB = 1024 * 1024;
    const issuePaths = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
      result.error?.issues.map((i) => i.path.join('.')) ?? [];

    it('accepts equal values and the defaults', () => {
      const equal = { ...DEFAULT_FILES_SYSTEM_SETTINGS, fullViewMaxBytes: 4 * MB, pagedViewMaxBytes: 4 * MB, downloadMaxBytes: 4 * MB };
      expect(filesSystemSettingsSchema.safeParse(equal).success).toBe(true);
    });

    it('refuses a stored or PUT value whose full view exceeds the paged view, naming fullViewMaxBytes', () => {
      const bad = { ...DEFAULT_FILES_SYSTEM_SETTINGS, fullViewMaxBytes: 8 * MB, pagedViewMaxBytes: 4 * MB };
      const result = filesSystemSettingsSchema.safeParse(bad);
      expect(result.success).toBe(false);
      expect(issuePaths(result as never)).toEqual(['fullViewMaxBytes']);
      expect(FILES_SYSTEM_SETTINGS.putSchema.safeParse(bad).success).toBe(false);
    });

    it('refuses a paged view above the download cap, naming pagedViewMaxBytes', () => {
      const bad = { ...DEFAULT_FILES_SYSTEM_SETTINGS, pagedViewMaxBytes: 300 * MB, downloadMaxBytes: 100 * MB };
      const result = filesSystemSettingsSchema.safeParse(bad);
      expect(issuePaths(result as never)).toEqual(['pagedViewMaxBytes']);
      expect(result.error?.issues[0]?.message).toMatch(/pagedViewMaxBytes must not exceed downloadMaxBytes/);
    });

    it('names both fields when both pairs are out of order', () => {
      const bad = { ...DEFAULT_FILES_SYSTEM_SETTINGS, fullViewMaxBytes: 16 * MB, pagedViewMaxBytes: 8 * MB, downloadMaxBytes: 4 * MB };
      expect(issuePaths(filesSystemSettingsSchema.safeParse(bad) as never).sort()).toEqual(['fullViewMaxBytes', 'pagedViewMaxBytes']);
    });

    it('a PATCH body alone is not judged (it is partial); the MERGED value is, by the platform, against the stored schema', () => {
      const patch = filesSystemSettingsPatchSchema.parse({ downloadMaxBytes: 10 * MB });
      expect(patch).toEqual({ downloadMaxBytes: 10 * MB });
      const merged = FILES_SYSTEM_SETTINGS.merge(DEFAULT_FILES_SYSTEM_SETTINGS, patch);
      const result = filesSystemSettingsSchema.safeParse(merged);
      expect(result.success).toBe(false);
      expect(issuePaths(result as never)).toEqual(['pagedViewMaxBytes']);
      const ok = FILES_SYSTEM_SETTINGS.merge(DEFAULT_FILES_SYSTEM_SETTINGS, { downloadMaxBytes: 4 * 1024 * MB });
      expect(filesSystemSettingsSchema.safeParse(ok).success).toBe(true);
    });
  });
});
