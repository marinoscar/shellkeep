// =============================================================================
// Zod schemas of the v2 key layout and options (issue #165)
// =============================================================================
//
// The `shortcuts.layout` and `shortcuts.options` fields of the `shortcuts`
// user-settings namespace. The key model (catalog ids, caps, defaults) is the
// mirrored `keys/key-model.ts`. Every object is `.strict()` and every field is
// required (but `options.layoutVersion`): the platform refuses `.default()` in a user namespace.
// =============================================================================

import { z } from 'zod';
import {
  CATALOG_KEY_IDS,
  CHORD_NAMED_KEYS,
  GRID_COLUMNS,
  MAX_INLINE_KEYS,
  MAX_KEY_GROUPS,
  MAX_KEY_LABEL_LENGTH,
  MAX_KEYS_PER_GROUP,
  MAX_MACRO_CHORDS,
  MAX_CUSTOM_SEQUENCE_LENGTH,
  entrySpan,
  isChordKey,
  parseSequenceEscapes,
  type LayoutEntry,
} from './keys/key-model';

const spanSchema = z.union([z.literal(1), z.literal(2)]);

export const chordSchema = z
  .object({
    modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).max(4),
    key: z.string().refine(isChordKey, {
      message: `A chord key is one of ${CHORD_NAMED_KEYS.join(', ')} or one printable ASCII character.`,
    }),
  })
  .strict();

const labelSchema = z.string().min(1).max(MAX_KEY_LABEL_LENGTH);

export const macroKeySchema = z
  .object({
    kind: z.literal('macro'),
    id: z.string().uuid(),
    label: labelSchema,
    chords: z.array(chordSchema).min(1).max(MAX_MACRO_CHORDS),
  })
  .strict();

export const customKeySchema = z
  .object({
    kind: z.literal('custom'),
    id: z.string().uuid(),
    label: labelSchema,
    sequence: z
      .string()
      .min(1)
      .max(MAX_CUSTOM_SEQUENCE_LENGTH * 4)
      .superRefine((value, ctx) => {
        const parsed = parseSequenceEscapes(value);
        if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error });
      }),
  })
  .strict();

export const inlineKeySchema = z.discriminatedUnion('kind', [macroKeySchema, customKeySchema]);

export const layoutEntrySchema = z.union([
  z.object({ id: z.enum(CATALOG_KEY_IDS as [string, ...string[]]), span: spanSchema.optional() }).strict(),
  z.object({ key: inlineKeySchema, span: spanSchema.optional() }).strict(),
]);

export const keyGroupSchema = z
  .object({ keys: z.array(layoutEntrySchema).min(1).max(MAX_KEYS_PER_GROUP) })
  .strict()
  .refine((group) => group.keys.reduce((n, e) => n + entrySpan(e as LayoutEntry), 0) <= GRID_COLUMNS, {
    message: `A group's keys span at most ${GRID_COLUMNS} cells.`,
  });

export const keyLayoutSchema = z
  .object({ groups: z.array(keyGroupSchema).max(MAX_KEY_GROUPS) })
  .strict()
  .superRefine((layout, ctx) => {
    const ids = new Set<string>();
    let inline = 0;
    for (const group of layout.groups) {
      for (const entry of group.keys) {
        if (!('key' in entry)) continue;
        inline += 1;
        if (ids.has(entry.key.id)) {
          ctx.addIssue({ code: 'custom', message: `Inline key id ${entry.key.id} is used twice.` });
        }
        ids.add(entry.key.id);
      }
    }
    if (inline > MAX_INLINE_KEYS) {
      ctx.addIssue({ code: 'custom', message: `At most ${MAX_INLINE_KEYS} custom and macro keys.` });
    }
  });

export const keyOptionsSchema = z
  .object({
    autoHideWithHardwareKeyboard: z.boolean(),
    haptics: z.boolean(),
    // Optional, the only such field: the settings migration's marker (see `KeyOptions`).
    layoutVersion: z.literal(2).optional(),
  })
  .strict();
