/**
 * The live preview of the accessory row (#169): the terminal's own
 * `TerminalKeyShortcutsBar` over the layout being edited, in a non-sending
 * mode. Every handler is a no-op and a hold starts nothing (`beginHold`
 * returns `null`), so the keys look and feel like the row (modifier toggles,
 * the arrow-drag key) but send no bytes. Actions show as on a server session
 * with the assistant; Snippets stays hidden until #172, as in the row.
 */

import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { TerminalKeyShortcutsBar } from '../../TerminalKeyShortcutsBar';
import type { KeyLayout } from '../../../../lib/terminal/keys/keyModel';
import { resolveKeyGroups, type KeyActionId } from '../../../../lib/terminal/keys/keyRow';

const PREVIEW_ACTIONS: ReadonlySet<KeyActionId> = new Set<KeyActionId>(['ai', 'arrow-drag', 'attach-file']);

const noop = () => {};
const noHold = () => null;

export function KeyRowPreview({ layout }: { layout: KeyLayout }) {
  const groups = useMemo(() => resolveKeyGroups(layout, PREVIEW_ACTIONS), [layout]);
  return (
    <Box
      component="section"
      aria-label="Preview of the key row"
      data-testid="key-row-preview"
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper' }}
    >
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 1.5, pt: 1 }}>
        Preview: the row above the phone keyboard. These keys send nothing.
      </Typography>
      <TerminalKeyShortcutsBar
        open
        groups={groups}
        onKey={noop}
        onAction={noop}
        onToggleModifier={noop}
        beginHold={noHold}
      />
    </Box>
  );
}
