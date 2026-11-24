import type { TerminalViewHandle } from '../TerminalView';

/**
 * C0 controls (so `\r`, `\n`, tab, ESC and Ctrl+C all), DEL, the C1 range and the Unicode line
 * separators. Any of them in a suggestion could press a key for the user, so the suggestion
 * is refused whole instead of being "cleaned" into a command the model did not write.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * The command exactly as given when it is safe to put at a prompt, else `null`
 * (the card then offers Copy only). Never alters the text.
 */
export function sanitizeForInsert(command: string): string | null {
  if (command.trim() === '' || FORBIDDEN.test(command)) return null;
  return command;
}

/**
 * Put `command` at the pane's prompt with `terminal.paste`, so bracketed paste applies when the
 * shell turned it on, WITHOUT a trailing newline, and focus the pane. The user presses Enter.
 * Nothing is ever run (root AGENTS.md, AI rule 6).
 *
 * @returns whether the command was inserted.
 */
export function insertSuggestedCommand(view: TerminalViewHandle | null, command: string): boolean {
  const safe = sanitizeForInsert(command);
  const terminal = view?.getTerminal();
  if (safe === null || !view || !terminal) return false;
  terminal.paste(safe);
  view.focus();
  return true;
}
