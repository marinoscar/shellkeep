// =============================================================================
// Snippet placeholders (issue #172)
// =============================================================================
//
// `{{name}}` in a snippet body is a blank the user fills before the text is inserted. A name is a letter or
// underscore followed by up to 31 letters, digits, underscores or hyphens; spaces inside the braces are
// allowed (`{{ host }}`). Anything else (`{{ }}`, `{{1}}`, `${{x}}` in a shell expansion is still a
// placeholder: the braces are the marker) is left as typed. Pure: no React, no DOM.
// =============================================================================

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]{0,31})\s*\}\}/g;

/** The distinct placeholder names of a body, in order of first appearance. */
export function extractPlaceholders(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * The body with every placeholder replaced by its value (`''` when none was given). The values are inserted
 * literally: a value is never searched for placeholders again.
 */
export function fillPlaceholders(body: string, values: Readonly<Record<string, string>>): string {
  return body.replace(PLACEHOLDER, (_all, name: string) => values[name] ?? '');
}
