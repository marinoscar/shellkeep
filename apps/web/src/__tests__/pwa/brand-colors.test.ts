import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #148: the PWA manifest and the `theme-color` meta follow
 * packages/shared/identity.json, the colours the Android build reads too.
 * The config is pinned as source, like the service worker's (#51).
 */

const root = join(__dirname, '..', '..', '..');
const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

describe('PWA brand colours (#148)', () => {
  it('takes the manifest colours from @shellkeep/shared', () => {
    expect(viteConfig).toMatch(/import \{ BACKGROUND_COLOR, THEME_COLOR \} from '@shellkeep\/shared'/);
    expect(viteConfig).toMatch(/theme_color:\s*THEME_COLOR/);
    expect(viteConfig).toMatch(/background_color:\s*BACKGROUND_COLOR/);
  });

  it('fills the theme-color meta from THEME_COLOR at build time', () => {
    expect(indexHtml).toContain('<meta name="theme-color" content="%SHELLKEEP_THEME_COLOR%" />');
    expect(viteConfig).toContain("replaceAll('%SHELLKEEP_THEME_COLOR%', THEME_COLOR)");
  });

  it('writes no colour literal for either', () => {
    expect(viteConfig).not.toMatch(/(theme|background)_color:\s*'#/);
    expect(indexHtml).not.toMatch(/name="theme-color" content="#/);
  });
});
