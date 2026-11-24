import { describe, it, expect } from 'vitest';
import { defaultAiAssistShortcut, matchesAiAssistShortcut } from './aiAssistShortcut';

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: 'a', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe('AI assist shortcut (#57)', () => {
  it('is Ctrl+Shift+A on Linux and Windows', () => {
    expect(defaultAiAssistShortcut(false)).toEqual({ modifiers: ['ctrl', 'shift'], key: 'a' });
    expect(matchesAiAssistShortcut(key({ ctrlKey: true, shiftKey: true, key: 'A' }), undefined, false)).toBe(true);
    expect(matchesAiAssistShortcut(key({ metaKey: true, shiftKey: true }), undefined, false)).toBe(false);
  });

  it('is Cmd+Shift+A on macOS', () => {
    expect(matchesAiAssistShortcut(key({ metaKey: true, shiftKey: true, key: 'A' }), undefined, true)).toBe(true);
    expect(matchesAiAssistShortcut(key({ ctrlKey: true, shiftKey: true }), undefined, true)).toBe(false);
  });

  it('needs exact modifiers: plain Ctrl+A and Ctrl+Alt+Shift+A are not it', () => {
    expect(matchesAiAssistShortcut(key({ ctrlKey: true }), undefined, false)).toBe(false);
    expect(matchesAiAssistShortcut(key({ ctrlKey: true, shiftKey: true, altKey: true }), undefined, false)).toBe(false);
  });

  it('honours a stored rebinding instead of the default', () => {
    const binding = { modifiers: ['alt' as const], key: 'k' as const };
    expect(matchesAiAssistShortcut(key({ altKey: true, key: 'k' }), binding, false)).toBe(true);
    expect(matchesAiAssistShortcut(key({ ctrlKey: true, shiftKey: true }), binding, false)).toBe(false);
  });
});
