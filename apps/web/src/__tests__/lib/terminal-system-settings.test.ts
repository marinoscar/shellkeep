import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TERMINAL_SYSTEM_SETTINGS,
  readTerminalSystemSettings,
  thresholdError,
} from '../../lib/terminal/system-settings';

describe('terminal system settings (#46)', () => {
  it('fills in the defaults while the namespace is absent', () => {
    expect(readTerminalSystemSettings(null)).toEqual(DEFAULT_TERMINAL_SYSTEM_SETTINGS);
    expect(readTerminalSystemSettings({ version: 1 })).toEqual(DEFAULT_TERMINAL_SYSTEM_SETTINGS);
    expect(
      readTerminalSystemSettings({ version: 1, terminal: { detachAfterMinutes: 30 } }),
    ).toEqual({ ...DEFAULT_TERMINAL_SYSTEM_SETTINGS, detachAfterMinutes: 30 });
  });

  it.each([
    ['detachAfterMinutes', '5', null],
    ['detachAfterMinutes', '1440', null],
    ['detachAfterMinutes', '4', 'Enter a whole number from 5 to 1440.'],
    ['detachAfterMinutes', '1441', 'Enter a whole number from 5 to 1440.'],
    ['terminateDetachedAfterHours', '0', 'Enter a whole number from 1 to 720.'],
    ['terminateDetachedAfterHours', '720', null],
    ['purgeTerminatedAfterDays', '366', 'Enter a whole number from 1 to 365.'],
    ['purgeTerminatedAfterDays', '2.5', 'Enter a whole number from 1 to 365.'],
    ['purgeTerminatedAfterDays', '', 'Enter a whole number from 1 to 365.'],
  ] as const)('%s = %j -> %j', (field, raw, expected) => {
    expect(thresholdError(field, raw)).toBe(expected);
  });
});
