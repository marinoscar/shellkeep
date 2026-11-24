// =============================================================================
// Reading the model's answer to a command-assist request (issue #57)
// =============================================================================
//
// The model is asked for exactly two parts:
//
//   COMMAND: <one line>
//   WHY: <short explanation>
//
// The command is the only part that can ever reach a terminal, and only as text the user
// inserts and runs themselves. It is parsed here, on the server, and must be ONE plain line:
// no newline, no control character, no escape. Anything else is `null` (AI_ASSIST_UNPARSEABLE)
// rather than a command "cleaned up" into something the model did not write.
// =============================================================================

import { z } from 'zod';

export const ASSIST_COMMAND_MAX = 1000;
export const ASSIST_EXPLANATION_MAX = 1000;

/** C0 (including tab, CR, LF, ESC), DEL and C1 controls. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const assistResultSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(ASSIST_COMMAND_MAX)
    .refine((value) => !CONTROL.test(value), 'The command holds a control character'),
  explanation: z.string().trim().max(ASSIST_EXPLANATION_MAX),
});

export type AssistParsed = z.infer<typeof assistResultSchema>;

/** Drops a wrapping pair of backticks the model sometimes adds despite the instructions. */
const unwrapBackticks = (value: string): string => {
  const trimmed = value.trim();
  const match = /^`([^`]+)`$/.exec(trimmed);
  return match ? (match[1] as string) : trimmed;
};

/** Parses the full model text; `null` when it holds no usable `COMMAND:` line. */
export function parseAssistOutput(text: string): AssistParsed | null {
  // Markdown fences are forbidden by the instructions; ignore the fence lines themselves.
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*```/.test(line));

  const commandIndex = lines.findIndex((line) => /^\s*COMMAND:/i.test(line));
  if (commandIndex === -1) return null;
  const rawCommand = (lines[commandIndex] as string).replace(/^\s*COMMAND:/i, '');

  let explanation = '';
  const whyIndex = lines.findIndex((line, i) => i > commandIndex && /^\s*WHY:/i.test(line));
  if (whyIndex !== -1) {
    explanation = [(lines[whyIndex] as string).replace(/^\s*WHY:/i, ''), ...lines.slice(whyIndex + 1)]
      .join(' ')
      .replace(/\s+/g, ' ');
  }

  const parsed = assistResultSchema.safeParse({
    command: unwrapBackticks(rawCommand),
    explanation: explanation.length > ASSIST_EXPLANATION_MAX ? explanation.slice(0, ASSIST_EXPLANATION_MAX) : explanation,
  });
  return parsed.success ? parsed.data : null;
}
