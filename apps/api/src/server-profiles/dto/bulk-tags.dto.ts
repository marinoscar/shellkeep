import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { tagSchema } from './server-profiles-query.dto';

/** The most profiles one bulk call may name (#79). */
export const BULK_MAX_IDS = 200;

/**
 * `PATCH /api/server-profiles/bulk-tags`: add and/or remove tags on many profiles. At least one of
 * `add` and `remove` is non-empty; a tag in both is refused (the order would be ambiguous).
 */
export const bulkTagsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(BULK_MAX_IDS),
    add: z.array(tagSchema).max(20).optional().default([]),
    remove: z.array(tagSchema).max(20).optional().default([]),
  })
  .refine((body) => body.add.length + body.remove.length > 0, {
    message: 'Name at least one tag to add or remove',
    path: ['add'],
  })
  .refine((body) => !body.add.some((tag) => body.remove.includes(tag)), {
    message: 'A tag cannot be both added and removed',
    path: ['remove'],
  });

export type BulkTagsInput = z.infer<typeof bulkTagsSchema>;

export class BulkTagsDto extends createZodDto(bulkTagsSchema) {}

/** What a bulk-tags call did, per id. An id the caller may not change is reported, never a failure. */
export interface BulkTagsResult {
  /** Profiles whose tags changed. */
  updated: string[];
  /** Profiles the caller may change that already had the requested tags. */
  unchanged: string[];
  /** Profiles that do not exist, are not visible, or that the caller may not write. */
  denied: string[];
}
