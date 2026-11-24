import { describe, it, expect } from 'vitest';
import { isTypingKey, looksLikeHardwareKey, type KeyEventLike } from './hardwareKeys';

const key = (init: Partial<KeyEventLike>): KeyEventLike => ({
  key: 'a',
  code: 'KeyA',
  keyCode: 65,
  isComposing: false,
  ...init,
});

describe('looksLikeHardwareKey (#170)', () => {
  it('is true for a physical key with a code', () => {
    expect(looksLikeHardwareKey(key({}))).toBe(true);
    expect(looksLikeHardwareKey(key({ key: 'Escape', code: 'Escape', keyCode: 27 }))).toBe(true);
    expect(looksLikeHardwareKey(key({ key: 'F5', code: 'F5', keyCode: 116 }))).toBe(true);
  });

  it.each([
    ['an Android soft keyboard placeholder', { key: 'Unidentified', code: '', keyCode: 229 }],
    ['keyCode 229 with a key', { key: 'a', code: 'KeyA', keyCode: 229 }],
    ['an IME composition', { isComposing: true }],
    ['a Process key', { key: 'Process', code: 'KeyA' }],
    ['a dead key', { key: 'Dead', code: 'Quote' }],
    ['no code', { code: '' }],
  ])('is false for %s', (_name, init) => {
    expect(looksLikeHardwareKey(key(init as Partial<KeyEventLike>))).toBe(false);
  });
});

describe('isTypingKey (#170)', () => {
  it('accepts printable characters and navigation, editing and function keys', () => {
    for (const k of ['a', 'Z', '%', ' ', '😀', 'Escape', 'Tab', 'Enter', 'ArrowLeft', 'Home', 'PageDown', 'F1', 'F12', 'Delete']) {
      expect(isTypingKey(k)).toBe(true);
    }
  });

  it('rejects modifiers alone and media keys', () => {
    for (const k of ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'AudioVolumeUp', 'Unidentified']) {
      expect(isTypingKey(k)).toBe(false);
    }
  });
});
