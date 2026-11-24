import type { TerminalViewHandle } from '../TerminalView';

/**
 * A suggested command as it may be typed at the prompt: line breaks become
 * spaces and trailing whitespace is dropped, so inserting it can never press
 * Enter (`\r` or `\n` would run it). The user reads it and presses Enter.
 */
export function toInsertableCommand(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ').replace(/\s+$/, '');
}

/**
 * Type `text` at the pane's prompt through `sendInput`, WITHOUT a trailing
 * newline, and focus the pane. Nothing is ever run (root AGENTS.md, AI rule 6).
 *
 * @returns whether anything was typed.
 */
export function insertSuggestedCommand(view: TerminalViewHandle | null, text: string): boolean {
  const command = toInsertableCommand(text);
  if (!view || !command) return false;
  view.sendInput(command);
  view.focus();
  return true;
}
