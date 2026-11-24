import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ASSIST_PROMPT_MAX = 2000;

export const terminalAssistSchema = z.object({
  sessionId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(ASSIST_PROMPT_MAX),
  includeScreen: z.boolean().default(true),
});

export class TerminalAssistDto extends createZodDto(terminalAssistSchema) {}
