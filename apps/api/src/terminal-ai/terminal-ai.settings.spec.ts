import {
  DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS,
  TERMINAL_AI_SYSTEM_SETTINGS,
  TERMINAL_AI_USER_SETTINGS,
  tightenTerminalAiSettings,
  terminalAiSystemSettingsSchema,
  terminalAiUserSettingsSchema,
} from './terminal-ai.settings';
import { TERMINAL_AI_APP_METRICS } from './terminal-ai.metrics';
import { REDACTION_KINDS } from '../command-safety';

describe('terminalAi system settings', () => {
  it('defaults to standard redaction with consent required', () => {
    expect(DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS).toEqual({ redactionMode: 'standard', requireConsent: true });
  });

  it('validates the mode', () => {
    expect(terminalAiSystemSettingsSchema.safeParse({ redactionMode: 'loose', requireConsent: true }).success).toBe(false);
    expect(terminalAiSystemSettingsSchema.safeParse({ redactionMode: 'strict', requireConsent: false }).success).toBe(true);
  });

  it('merges a patch field by field', () => {
    expect(
      TERMINAL_AI_SYSTEM_SETTINGS.merge(DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS, { redactionMode: 'strict' }),
    ).toEqual({ redactionMode: 'strict', requireConsent: true });
  });

  describe('the organization layer only tightens', () => {
    it('strict wins either way', () => {
      expect(tightenTerminalAiSettings({ redactionMode: 'standard', requireConsent: true }, { redactionMode: 'strict' }).redactionMode).toBe('strict');
      expect(tightenTerminalAiSettings({ redactionMode: 'strict', requireConsent: true }, { redactionMode: 'standard' }).redactionMode).toBe('strict');
    });

    it('consent required wins either way', () => {
      expect(tightenTerminalAiSettings({ redactionMode: 'standard', requireConsent: false }, { requireConsent: true }).requireConsent).toBe(true);
      expect(tightenTerminalAiSettings({ redactionMode: 'standard', requireConsent: true }, { requireConsent: false }).requireConsent).toBe(true);
    });

    it('an empty org layer changes nothing', () => {
      expect(tightenTerminalAiSettings({ redactionMode: 'standard', requireConsent: false }, {})).toEqual({
        redactionMode: 'standard',
        requireConsent: false,
      });
    });
  });
});

describe('terminalAi user settings', () => {
  it('stores an ISO timestamp or null', () => {
    expect(terminalAiUserSettingsSchema.safeParse({ consentAcceptedAt: '2026-11-24T10:00:00.000Z' }).success).toBe(true);
    expect(terminalAiUserSettingsSchema.safeParse({ consentAcceptedAt: null }).success).toBe(true);
    expect(terminalAiUserSettingsSchema.safeParse({ consentAcceptedAt: 'yesterday' }).success).toBe(false);
  });

  it('merges, and a null patch withdraws the namespace', () => {
    const at = '2026-11-24T10:00:00.000Z';
    expect(TERMINAL_AI_USER_SETTINGS.merge(undefined, { consentAcceptedAt: at })).toEqual({ consentAcceptedAt: at });
    expect(TERMINAL_AI_USER_SETTINGS.merge({ consentAcceptedAt: at }, undefined)).toEqual({ consentAcceptedAt: at });
    expect(TERMINAL_AI_USER_SETTINGS.merge({ consentAcceptedAt: at }, null as never)).toBeUndefined();
  });
});

describe('app.terminal_ai.redactions', () => {
  it('is a counter labelled by redaction kind only', () => {
    expect(TERMINAL_AI_APP_METRICS).toHaveLength(1);
    const [metric] = TERMINAL_AI_APP_METRICS;
    expect(metric).toMatchObject({ name: 'app.terminal_ai.redactions', kind: 'counter' });
    expect(Object.keys(metric.attributes ?? {})).toEqual(['kind']);
    expect(metric.attributes?.kind).toEqual({ kind: 'enum', values: [...REDACTION_KINDS] });
  });
});
