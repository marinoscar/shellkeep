import type { Keystroke } from '../../types/terminal';
import { isMacPlatform, matchesKeystroke } from './aiAssistShortcut';

/** The action id under which a rebinding is stored (`shortcuts.actions`). */
export const AI_EXPLAIN_ACTION = 'terminal.aiExplain';

/** The built-in binding: Mod+Shift+E. */
export function defaultAiExplainShortcut(mac: boolean = isMacPlatform()): Keystroke {
  return { modifiers: mac ? ['meta', 'shift'] : ['ctrl', 'shift'], key: 'e' };
}

/** Whether `event` is the explain shortcut (a stored rebinding, else Mod+Shift+E). Exact modifiers. */
export function matchesAiExplainShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  binding?: Keystroke,
  mac: boolean = isMacPlatform(),
): boolean {
  return matchesKeystroke(event, binding ?? defaultAiExplainShortcut(mac));
}
