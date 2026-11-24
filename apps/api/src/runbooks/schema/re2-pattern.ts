// =============================================================================
// RE2 pattern compilation (issue #61)
// =============================================================================
//
// Every `allow`, `deny` and parameter `pattern` of a runbook definition is an RE2
// expression: linear-time matching, no backtracking, no look-around and no
// back-references, so a hostile or careless pattern cannot stall the API or the
// AI harness. The `re2` package is native; it is loaded on first use so a process
// that never validates a definition does not pay for it.
// =============================================================================

import RE2 from 're2';

/** The compile error of `pattern` as a short message, or `null` when it is a valid RE2 expression. */
export function re2CompileError(pattern: string): string | null {
  try {
    new RE2(pattern, 'u');
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `re2` reports "Invalid regular expression: /<pattern>/u: <reason>"; keep only the reason.
    const reason = message.replace(/^Invalid regular expression: .*?\/[a-z]*: /s, '');
    return reason.slice(0, 200);
  }
}

/** Whether `value` matches the RE2 expression `pattern` (unanchored). A pattern that does not compile matches nothing. */
export function re2Test(pattern: string, value: string): boolean {
  try {
    return new RE2(pattern, 'u').test(value);
  } catch {
    return false;
  }
}
