import { describe, it, expect } from 'vitest';
import { defaultAiExplainShortcut, matchesAiExplainShortcut } from './aiExplainShortcut';

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: 'e', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe('AI explain shortcut (#58)', () => {
  it('is Ctrl+Shift+E on Linux and Windows, Cmd+Shift+E on macOS', () => {
    expect(defaultAiExplainShortcut(false)).toEqual({ modifiers: ['ctrl', 'shift'], key: 'e' });
    expect(matchesAiExplainShortcut(key({ ctrlKey: true, shiftKey: true, key: 'E' }), undefined, false)).toBe(true);
    expect(matchesAiExplainShortcut(key({ metaKey: true, shiftKey: true, key: 'E' }), undefined, true)).toBe(true);
    expect(matchesAiExplainShortcut(key({ metaKey: true, shiftKey: true }), undefined, false)).toBe(false);
  });

  it('needs exact modifiers and honours a rebinding', () => {
    expect(matchesAiExplainShortcut(key({ ctrlKey: true }), undefined, false)).toBe(false);
    const binding = { modifiers: ['alt' as const], key: 'x' as const };
    expect(matchesAiExplainShortcut(key({ altKey: true, key: 'x' }), binding, false)).toBe(true);
  });
});
