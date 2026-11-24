// =============================================================================
// Inserting a snippet into a terminal (issue #172)
// =============================================================================
//
// A snippet is INSERTED at the prompt, never run: the user presses Enter. The text goes through
// `terminal.paste`, the same door as the AI assistant's suggested commands and a pasted clipboard, so
// bracketed paste applies when the shell turned it on (a multi-line snippet then stays at the prompt as
// one block). Three rules:
//
//   1. Control characters other than newline and tab are dropped (an ESC or Ctrl+C in a body must not press
//      a key), line endings become `\n`, and trailing line breaks are removed (the last one would be Enter).
//   2. A multi-line snippet needs bracketed paste. Without it xterm turns every newline into Enter and the
//      shell would run the lines as they arrive, so the result is `needs-confirmation` and the caller asks
//      the user before inserting with `confirmed`.
//   3. The text is never logged and never sent anywhere but the terminal.
// =============================================================================

import type { TerminalViewHandle } from '../../../components/terminal/TerminalView';

export type SnippetInsertResult = 'inserted' | 'needs-confirmation' | 'unavailable';

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;

/** The text that would be inserted, or `''` when nothing is left. */
export function prepareSnippetText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROLS, '').replace(/\n+$/, '');
}

export function insertSnippetText(
  view: Pick<TerminalViewHandle, 'getTerminal' | 'focus'> | null,
  text: string,
  options: { confirmed?: boolean } = {},
): SnippetInsertResult {
  const terminal = view?.getTerminal();
  const safe = prepareSnippetText(text);
  if (!view || !terminal || safe === '') return 'unavailable';
  if (safe.includes('\n') && !terminal.modes?.bracketedPasteMode && !options.confirmed) return 'needs-confirmation';
  terminal.paste(safe);
  view.focus();
  return 'inserted';
}
