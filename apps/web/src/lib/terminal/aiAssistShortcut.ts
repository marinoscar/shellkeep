import type { Keystroke } from '../../types/terminal';

/** The action id under which a rebinding is stored (`shortcuts.actions`). */
export const AI_ASSIST_ACTION = 'terminal.aiAssist';

/** Cmd on macOS, Ctrl elsewhere: the "Mod" of Mod+Shift+A. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

/** The built-in binding: Mod+Shift+A. */
export function defaultAiAssistShortcut(mac: boolean = isMacPlatform()): Keystroke {
  return { modifiers: mac ? ['meta', 'shift'] : ['ctrl', 'shift'], key: 'a' };
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

/** Whether `event` is exactly `target`: the key and every modifier, no extra one. */
export function matchesKeystroke(event: KeyEventLike, target: Keystroke): boolean {
  const want = new Set(target.modifiers);
  return (
    event.key.toLowerCase() === target.key.toLowerCase() &&
    event.ctrlKey === want.has('ctrl') &&
    event.shiftKey === want.has('shift') &&
    event.altKey === want.has('alt') &&
    event.metaKey === want.has('meta')
  );
}

/** Whether `event` is the AI assist shortcut (a stored rebinding, else Mod+Shift+A). Exact modifiers. */
export function matchesAiAssistShortcut(
  event: KeyEventLike,
  binding?: Keystroke,
  mac: boolean = isMacPlatform(),
): boolean {
  return matchesKeystroke(event, binding ?? defaultAiAssistShortcut(mac));
}
