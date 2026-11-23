import { describe, it, expect } from 'vitest';
import { USER_SETTINGS_PANELS } from '../../config/userSettingsPanels';
import { KeyShortcutsSettings } from '../../components/terminal/settings/KeyShortcutsSettings';

describe('USER_SETTINGS_PANELS', () => {
  it('mounts the terminal key shortcuts panel', () => {
    expect(USER_SETTINGS_PANELS.map((p) => p.id)).toEqual(['terminal-key-shortcuts']);
    expect(USER_SETTINGS_PANELS[0].Component).toBe(KeyShortcutsSettings);
  });

  it('has unique ids', () => {
    expect(new Set(USER_SETTINGS_PANELS.map((p) => p.id)).size).toBe(USER_SETTINGS_PANELS.length);
  });
});
