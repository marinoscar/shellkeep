import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  SNIPPET_BODY_MAX_BYTES,
  SNIPPET_QUERY_MAX,
  SNIPPET_TAG_MAX,
  SNIPPET_TAGS_MAX,
  SNIPPET_TITLE_MAX,
  SNIPPETS_PER_USER_MAX,
} from './snippets.constants';

const titleSchema = z.string().trim().min(1, 'Title is required').max(SNIPPET_TITLE_MAX);

// Text only: no NUL byte; a snippet may hold newlines and tabs. The cap is in BYTES (UTF-8), as the CHECK is.
const bodySchema = z
  .string()
  .min(1, 'Body is required')
  .refine((value) => !value.includes('\0'), 'Body must be text')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= SNIPPET_BODY_MAX_BYTES, `Body must be at most ${SNIPPET_BODY_MAX_BYTES} bytes`);

const tagsSchema = z
  .array(z.string().trim().min(1).max(SNIPPET_TAG_MAX))
  .max(SNIPPET_TAGS_MAX)
  .transform((tags) => [...new Set(tags)]);

export const createSnippetSchema = z.object({
  title: titleSchema,
  body: bodySchema,
  tags: tagsSchema.optional().default([]),
});
export class CreateSnippetDto extends createZodDto(createSnippetSchema) {}

export const updateSnippetSchema = z
  .object({ title: titleSchema.optional(), body: bodySchema.optional(), tags: tagsSchema.optional() })
  .refine((value) => value.title !== undefined || value.body !== undefined || value.tags !== undefined, 'Nothing to update');
export class UpdateSnippetDto extends createZodDto(updateSnippetSchema) {}

export const orderSnippetsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(SNIPPETS_PER_USER_MAX) });
export class OrderSnippetsDto extends createZodDto(orderSnippetsSchema) {}

export const listSnippetsQuerySchema = z.object({ query: z.string().trim().max(SNIPPET_QUERY_MAX).optional() });
export class ListSnippetsQueryDto extends createZodDto(listSnippetsQuerySchema) {}
