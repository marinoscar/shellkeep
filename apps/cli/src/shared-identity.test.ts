import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_NAME, BACKGROUND_COLOR, BRAND, CLI_NAME, REPO_SLUG, TAGLINE, THEME_COLOR } from '@shellkeep/shared';
import { describe, expect, it } from 'vitest';

// packages/shared/identity.json is the one place the product name, CLI name and
// repository slug are written (platform-infra sync reads the same file); the
// package's exports must be exactly its values.

const identity = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'shared', 'identity.json'), 'utf8'),
) as { productName: string; cliName: string; repoSlug: string; themeColor: string; backgroundColor: string; tagline: string };

describe('@shellkeep/shared', () => {
  it('exports APP_NAME, CLI_NAME and REPO_SLUG from identity.json', () => {
    expect(APP_NAME).toBe(identity.productName);
    expect(CLI_NAME).toBe(identity.cliName);
    expect(REPO_SLUG).toBe(identity.repoSlug);
    expect([APP_NAME, CLI_NAME, REPO_SLUG]).toEqual(['ShellKeep', 'shellkeep', 'marinoscar/shellkeep']);
  });

  it('keeps the CLI name a valid executable and config-directory seed', () => {
    expect(CLI_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('exports TAGLINE from identity.json', () => {
    expect(TAGLINE).toBe(identity.tagline);
  });

  it('exports THEME_COLOR and BACKGROUND_COLOR from identity.json', () => {
    expect(THEME_COLOR).toBe(identity.themeColor);
    expect(BACKGROUND_COLOR).toBe(identity.backgroundColor);
  });
});

// The Option A palette (#148). Android reads themeColor and backgroundColor
// from identity.json directly, so the palette must agree with the two fields.

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two `#RRGGBB` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('BRAND', () => {
  it('holds the Option A accents and backgrounds', () => {
    expect(BRAND.light).toMatchObject({ accent: '#0F766E', accentInk: '#FFFFFF', bg: '#F6F7F9', surface: '#FFFFFF' });
    expect(BRAND.dark).toMatchObject({ accent: '#2DD4BF', accentInk: '#0B2B27', bg: '#0F1115', surface: '#171A21' });
  });

  it('agrees with identity.json: themeColor is the light accent, backgroundColor the dark bg', () => {
    expect(THEME_COLOR).toBe(BRAND.light.accent);
    expect(BACKGROUND_COLOR).toBe(BRAND.dark.bg);
  });

  it('gives both modes the same tokens, every one a #RRGGBB hex, frozen', () => {
    expect(Object.keys(BRAND.dark).sort()).toEqual(Object.keys(BRAND.light).sort());
    for (const tokens of [BRAND.light, BRAND.dark]) {
      for (const value of Object.values(tokens)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
      expect(Object.isFrozen(tokens)).toBe(true);
    }
    expect(Object.isFrozen(BRAND)).toBe(true);
  });

  it('keeps white status-bar icons readable on THEME_COLOR (WCAG AA)', () => {
    expect(contrast(THEME_COLOR, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['light', 'dark'] as const)('keeps WCAG AA text contrast in %s', (mode) => {
    const t = BRAND[mode];
    const pairs: Array<[string, string]> = [
      [t.accentInk, t.accent],
      [t.text, t.bg],
      [t.text, t.surface],
      [t.muted, t.bg],
      [t.muted, t.surface],
      [t.muted, t.surface2],
      [t.accentText, t.bg],
      [t.accentText, t.surface],
      [t.termText, t.term],
      ...[t.ok, t.warn, t.err, t.info].flatMap((tone): Array<[string, string]> => [
        [tone, t.bg],
        [tone, t.surface],
      ]),
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
