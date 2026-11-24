import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A connection test's outcome, as the health column shows it (#79). */
export const SERVER_HEALTH = ['reachable', 'unreachable', 'unknown'] as const;
export type ServerHealth = (typeof SERVER_HEALTH)[number];

/** The host-key state of a profile (#60, #79). `mismatch`: the last test was refused for a changed key. */
export const SERVER_HOST_KEY_STATES = ['trusted', 'untrusted', 'mismatch'] as const;
export type ServerHostKeyState = (typeof SERVER_HOST_KEY_STATES)[number];

/** The columns the list sorts by. */
export const SERVER_PROFILE_SORTS = ['name', 'hostname', 'health', 'lastSession', 'updatedAt'] as const;
export type ServerProfileSort = (typeof SERVER_PROFILE_SORTS)[number];

/** A tag as stored and filtered: trimmed, 1 to 50 characters. */
export const tagSchema = z.string().trim().min(1).max(50);

/** A query parameter that may repeat (`?tag=a&tag=b`) or be sent once; a comma list is split too. */
const repeatable = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(tagSchema).max(20));

/** `me`, `shared`, or `group:<uuid>` (the profiles a group owns). */
const ownerSchema = z.union([
  z.enum(['me', 'shared']),
  z
    .string()
    .regex(/^group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'owner must be me, shared or group:<uuid>'),
]);

export const serverProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Text search over the name, hostname and username (`search` is the older spelling). */
  q: z.string().trim().max(200).optional(),
  search: z.string().trim().max(200).optional(),
  /** `mine`: owned by me; `shared`: shared with me or owned by a group of mine; `all` (default): both. */
  filter: z.enum(['all', 'mine', 'shared']).default('all'),
  /** Narrows `filter`: `me` = `mine`, `shared` = `shared`, `group:<id>` = owned by that group. */
  owner: ownerSchema.optional(),
  /** Profiles carrying EVERY one of these tags. */
  tag: repeatable.optional(),
  health: z.enum(SERVER_HEALTH).optional(),
  hostKey: z.enum(SERVER_HOST_KEY_STATES).optional(),
  /** Default `updatedAt` (newest first). */
  sort: z.enum(SERVER_PROFILE_SORTS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export type ServerProfilesQuery = z.infer<typeof serverProfilesQuerySchema>;

export class ServerProfilesQueryDto extends createZodDto(serverProfilesQuerySchema) {}
