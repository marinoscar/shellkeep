// Through the platform's COMPOSED schemas (what `PATCH` and `PUT /api/system-settings` validate),
// not just this namespace's own: the ordering rule must survive composition.

import '../../shellkeep.manifest';
import { currentSystemSettingsSchema, currentUpdateSystemSettingsSchema, composeDefaultSystemSettings } from '@marinoscar/platform-api/settings';

describe('files size ordering in the composed system settings', () => {
  const MB = 1024 * 1024;
  const defaults = composeDefaultSystemSettings() as unknown as Record<string, unknown> & { files: Record<string, number> };

  it('validates the merged value of a PATCH and names the field out of order', () => {
    const merged = { ...defaults, files: { ...defaults.files, downloadMaxBytes: 10 * MB } };
    const result = currentSystemSettingsSchema().safeParse(merged);
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(paths).toContain('files.pagedViewMaxBytes');
  });

  it('refuses a PUT body out of order and accepts the defaults', () => {
    const bad = { ...defaults, files: { ...defaults.files, fullViewMaxBytes: 16 * MB, pagedViewMaxBytes: 8 * MB } };
    const result = currentUpdateSystemSettingsSchema().safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('files.fullViewMaxBytes');
    expect(currentSystemSettingsSchema().safeParse(defaults).success).toBe(true);
  });
});
