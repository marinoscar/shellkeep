import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #170: the on-screen keyboard must shrink the VISUAL viewport only, in the
 * browser and in the Android TWA, or `useKeyboardInset` (layout height minus
 * visual height) reads 0 and the key row, the docked key panel and the
 * hardware keyboard detection lose the keyboard. Pinned as source.
 */
const indexHtml = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8');
const viewport = /<meta name="viewport" content="([^"]+)"/.exec(indexHtml)?.[1] ?? '';

describe('the viewport meta (#170)', () => {
  it('pins interactive-widget=resizes-visual', () => {
    expect(viewport.split(',').map((part) => part.trim())).toContain('interactive-widget=resizes-visual');
  });

  it('never resizes the layout for the keyboard (resizes-content) or overlays it', () => {
    expect(viewport).not.toMatch(/resizes-content|overlays-content/);
  });

  it('keeps width=device-width and zoom enabled', () => {
    expect(viewport).toMatch(/width=device-width/);
    expect(viewport).toMatch(/initial-scale=1\.0/);
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale/);
  });
});
