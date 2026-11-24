import type { ApiBodyOptions } from '@nestjs/swagger';

type BodySchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];
import { z } from 'zod';

/** The most selected text one request may carry (matches `TERMINAL_AI_LIMITS.explainSelectionBytes`). */
export const EXPLAIN_SELECTION_MAX = 16384;

/**
 * `selection`: text the user marked in the terminal (client text, redacted server-side like any
 * captured text). `last_error`: the server captures the last 200 lines itself.
 */
export const terminalExplainSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('selection'),
    sessionId: z.string().uuid(),
    selection: z.string().min(1).max(EXPLAIN_SELECTION_MAX),
  }),
  z.object({
    mode: z.literal('last_error'),
    sessionId: z.string().uuid(),
  }),
]);

/** A union cannot be a class, so the controller validates with `terminalExplainSchema` directly. */
export type TerminalExplainInput = z.infer<typeof terminalExplainSchema>;

/** The OpenAPI body: the two modes of the discriminated union. */
export const TERMINAL_EXPLAIN_BODY_SCHEMA: BodySchema = {
  oneOf: [
    {
      type: 'object',
      required: ['mode', 'sessionId', 'selection'],
      properties: {
        mode: { type: 'string', enum: ['selection'] },
        sessionId: { type: 'string', format: 'uuid' },
        selection: { type: 'string', minLength: 1, maxLength: EXPLAIN_SELECTION_MAX },
      },
    },
    {
      type: 'object',
      required: ['mode', 'sessionId'],
      properties: {
        mode: { type: 'string', enum: ['last_error'] },
        sessionId: { type: 'string', format: 'uuid' },
      },
    },
  ],
};
